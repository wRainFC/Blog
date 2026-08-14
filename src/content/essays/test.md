---
title: 测试
summary: nothing here
pubDate: 2026-07-20
tags:
  - 测试
draft: false
featured: false
---

# 什么是宏？——以 NEMU 中的宏为例

> 本文以 `nemu/include` 和 `nemu/src` 中的真实代码为例，讲解 C 预处理宏的语法、展开规则与工程应用，之后重点分析 `nemu/include/macro.h`，以及配置、ISA 抽象、指令译码、日志和设备代码中的宏设计。

## 1. 宏在 NEMU 中承担什么工作

NEMU 中的宏大体可以分为五类：

1. **预处理工具**：负责字符串化、标识符拼接、求数组长度等工作，如 `str`、`concat`、`ARRLEN`。
2. **配置裁剪**：借助 Kconfig 生成的 `CONFIG_*` 宏，在预处理阶段挑选类型、表达式或整段代码，如 `MUXDEF`、`IFDEF`。
3. **位操作与底层属性**：提取指令字段、做符号扩展和地址对齐、给分支加预测提示，如 `BITS`、`SEXT`、`PG_ALIGN`、`likely`。
4. **领域专用语法（DSL）**：把指令模式、操作数译码和执行代码组织成表格式的写法，如 `INSTPAT`。
5. **工程辅助**：日志、断言、设备 I/O、X-macro 列表以及各种具名常量。

需要说明的是，宏在编译前只做 token（记号）替换，不具备普通 C 函数的类型检查和求值规则；同时 NEMU 还用到了不少 GNU C 扩展，所以下面这些宏并不都能原样移植到严格的 ISO C 编译器上：

- 语句表达式 `({ ... })`；
- 标签地址与计算 goto：`&&label`、`goto *ptr`；
- `##__VA_ARGS__` 消除空可变参数的多余逗号；
- `__attribute__`、`__builtin_expect`。

## 2. C 宏语法基础

### 2.1 宏由预处理器处理

C 源码从编写到变成可执行文件，大致要经过下面几个阶段：

```text
源文件
  ↓ 预处理：处理 #include、#define、#if，展开宏
预处理后的 C 代码
  ↓ 编译：类型检查并生成汇编
汇编代码
  ↓ 汇编、链接
可执行文件
```

宏的作用发生在第一步。预处理器处理的对象是 token，它并不理解完整的 C 类型和语义。例如：

```c
#define Mr vaddr_read

Mr(addr, 4)
```

预处理器只是把 token `Mr` 换成 `vaddr_read`，得到：

```c
vaddr_read(addr, 4)
```

它并不知道 `Mr` 是不是函数，也不会检查参数个数或返回类型——这些工作要等宏展开之后，才轮到编译器来做。

另外，宏名只有作为一个完整 token 出现时才会被替换，标识符的一部分并不会被展开。假设已经定义了 `Mr`，那么 `Mr` 会展开，而 `Mr_count` 保持原样。如果想主动拼接出新的标识符，就必须借助后文要讲的 `##`。

### 2.2 对象宏：给 token 序列命名

对象宏的语法很简单：

```c
#define 宏名 替换列表
```

NEMU 里最简单的例子是具名常量：

```c
#define TIMER_HZ 60
#define PAGE_SHIFT 12
#define PAGE_SIZE (1ul << PAGE_SHIFT)
#define PAGE_MASK (PAGE_SIZE - 1)
```

预处理器会递归地展开替换结果，所以用到 `PAGE_MASK` 时，大致会经历这样的过程：

```text
PAGE_MASK
→ (PAGE_SIZE - 1)
→ ((1ul << PAGE_SHIFT) - 1)
→ ((1ul << 12) - 1)
```

对象宏能替换的内容也不只是数字，类型、字符串、函数名甚至属性都可以：

```c
#define Mr vaddr_read
#define ANSI_FG_RED "\33[1;31m"
#define PG_ALIGN __attribute((aligned(4096)))
```

这三个例子分别充当函数别名、字符串片段和声明属性。

值得注意的是，对象宏没有 C 类型，也不占用存储空间。在纯 C 代码里，如果只是想定义一个带类型的常量，`enum`、`static const` 或者内联函数往往更稳妥；但宏的优势在于，它可以出现在数组长度、`#if` 表达式、声明属性和 token 拼接等普通变量到不了的位置。

### 2.3 函数式宏：带参数的文本模板

函数式宏的语法是：

```c
#define 宏名(形参1, 形参2) 替换列表
```

注意宏名和左括号之间不能有空格，否则含义就完全变了：

```c
#define F(x) ((x) + 1)  // 函数式宏
#define G (x)           // 对象宏，替换内容就是 (x)
```

NEMU 中典型的函数式宏有：

```c
#define BITMASK(bits) ((1ull << (bits)) - 1)
#define BITS(x, hi, lo) (((x) >> (lo)) & BITMASK((hi) - (lo) + 1))
#define NEMUTRAP(thispc, code) set_nemu_state(NEMU_END, thispc, code)
```

调用宏并不等于调用函数。实参会被原样嵌入宏体，如果某个形参出现了多次，实参就会被展开多次：

```c
#define BAD_SQUARE(x) x * x

BAD_SQUARE(a + b) // 展开为 a + b * a + b，优先级全乱了
BAD_SQUARE(i++)   // 就算补上括号，i 也会被自增两次
```

所以写表达式宏时，通常要给每个形参和整个结果都加上括号：

```c
#define SQUARE(x) ((x) * (x))
```

括号只能解决运算符优先级的问题，却治不了重复求值。如果需要"参数只求值一次"，或者需要类型检查，那就应该改用 `static inline` 函数。以 NEMU 的 `BITS` 为例，`x` 在展开后只出现一次，但 `lo` 会出现两次，所以边界参数依然不能传 `i++` 之类的表达式。

### 2.4 多行宏和反斜杠

一条 `#define` 默认在换行处结束，多行宏必须在每一个待续行的末尾写反斜杠 `\`：

```c
#define NEMUTRAP(thispc, code) \
  set_nemu_state(NEMU_END, thispc, code)
```

注意反斜杠必须是该行最后一个有效字符，如果后面还跟着空格或注释，不同工具链的续行结果可能不一致。另外，宏定义本身一般不带结尾分号，分号由调用者像普通语句那样补上：

```c
NEMUTRAP(s->pc, R(10));
```

如果宏定义自带分号，在声明、`if/else` 或表达式组合的场合就很容易多出空语句。

### 2.5 可变参数：`...` 与 `__VA_ARGS__`

宏可以接收数量不定的尾部参数：

```c
#define Log(format, ...) \
  _Log(ANSI_FMT("[%s:%d %s] " format, ANSI_FG_BLUE) "\n", \
       __FILE__, __LINE__, __func__, ##__VA_ARGS__)
```

其中 `format` 是固定参数，`...` 接收剩余的所有实参，`__VA_ARGS__` 则在宏体中代表这些实参。例如：

```c
Log("init finished");
Log("pc = " FMT_WORD, cpu.pc);
```

第二个调用里 `__VA_ARGS__` 展开为 `cpu.pc`；第一个调用没有额外参数，此时 NEMU 利用 GNU 扩展 `##__VA_ARGS__` 删除前面多余的逗号，让结果仍然是一个合法的函数调用。

标准 C23 提供了 `__VA_OPT__(,)` 来应对空可变参数，本项目采用的是更早、且被 GCC/Clang 广泛支持的 GNU 写法。

### 2.6 字符串化 `#` 与 token 拼接 `##`

这两个运算符只能出现在函数式宏的替换列表中，而且作用对象是宏形参。

#### `#形参`：把实参原样变成字符串

```c
#define SHOW_NAME(x) #x

SHOW_NAME(cpu.pc) // "cpu.pc"
```

如果参数本身是宏，紧挨着 `#` 时它不会先展开。NEMU 正是利用 `str`/`str_temp` 两层宏来控制"先展开还是先字符串化"，详见 3.1 节。

#### `左侧 ## 右侧`：拼成一个新 token

```c
#define NEMU_KEY_NAME(k) NEMU_KEY_ ## k,

NEMU_KEY_NAME(ESCAPE) // NEMU_KEY_ESCAPE,
```

同理，紧挨着 `##` 的参数也不会先展开。NEMU 用 `concat`/`concat_temp` 两层宏先展开参数再拼接，详见 3.3 节。

另外，`##` 的拼接结果必须能构成一个合法的 token。标识符加标识符、数字片段加后缀通常没问题，但两个任意的 C 片段就未必能拼到一起了。

### 2.7 条件编译指令

预处理器自带下面这些条件指令：

```c
#if 常量表达式
#ifdef 宏名
#ifndef 宏名
#elif 常量表达式
#else
#endif
```

NEMU 用它们来根据配置选择物理内存的存放方式：

```c
#if defined(CONFIG_PMEM_MALLOC)
static uint8_t *pmem = NULL;
#else
static uint8_t pmem[CONFIG_MSIZE] PG_ALIGN = {};
#endif
```

注意 `defined(NAME)` 只能用在 `#if`/`#elif` 的预处理常量表达式里，不能写进普通的 C 表达式。`#ifdef NAME` 等价于 `#if defined(NAME)`，`#ifndef` 正好相反。

在 `#if` 表达式中，宏会先展开，剩下的未知标识符一律按 `0` 处理。所以可以这样写：

```c
#if CONFIG_MBASE + CONFIG_MSIZE > 0x100000000ul
#define PMEM64 1
#endif
```

只要两个数值配置之和超过阈值，就定义 `PMEM64`。反过来，如果宏展开的结果是字符串，就没法直接放进这种算术表达式里。

NEMU 的 `IFDEF(CONFIG_X, code)` 是建立在普通宏展开之上的项目级工具，可以在结构体成员、函数参数这类地方灵活地保留或删掉一小段 token；而传统 `#if` 更适合清晰地包围大段、多分支的代码。两者发生在同一个预处理阶段，语法机制却不一样。

### 2.8 `#undef` 与宏的作用域

```c
#undef 宏名
```

`#undef` 可以取消之前的宏定义。宏没有 C 语言的块级作用域：即使在函数体内写 `#define macro(i)`，这个定义也会从当前预处理位置一直生效到文件结束，或者直到遇到相应的 `#undef`。

`include/cpu/decode.h` 里的 `pattern_decode()` 临时定义了一个名叫 `macro` 的辅助宏，用完立刻：

```c
#undef macro
```

这当然不是为了释放运行时资源，而是防止这个过于普通的名字污染后面的代码。

头文件保护利用的正是"宏从定义点起一直有效"这个性质：

```c
#ifndef __COMMON_H__
#define __COMMON_H__
// 头文件正文
#endif
```

文件第二次被包含时，`__COMMON_H__` 已经定义了，正文自然就被跳过。

### 2.9 多语句宏：`do { ... } while (0)`

先看一种错误的写法：

```c
#define CHECK_AND_WRITE(x) { check(x); write(x); }
```

如果调用者这样写：

```c
if (ready)
  CHECK_AND_WRITE(x);
else
  recover();
```

宏展开之后，代码块后面的分号会让 `else` 找不到配对的 `if`。NEMU 的惯用写法是：

```c
#define RMw(data) do { \
  if (rd != -1) Rw(rd, w, data); \
  else Mw(addr, w, data); \
} while (0)
```

`do ... while (0)` 只执行一次，但在语法上是一条必须以分号结尾的完整语句，所以可以放心地嵌进外层的 `if/else`。

宏大致可以按使用位置分为下面几类：

| 类型 | 例子 | 调用方式 |
| --- | --- | --- |
| 表达式宏 | `BITS(x, hi, lo)` | 像一个表达式，通常不自带分号 |
| 语句宏 | `RMw(data)`、`Assert(...)` | `do { ... } while (0)`，调用处加分号 |
| 声明片段宏 | `PG_ALIGN`、`IFDEF(..., char buf[128])` | 放在声明的约定位置 |
| GNU 语句表达式 | `io_read(reg)`、`SEXT(x, len)` | 内部可以写多条语句，整体又能返回一个值 |

最后一类 `({ ... })` 不是标准 C：括号里最后一条表达式语句的值会成为整个表达式的值。

### 2.10 宏实参的展开顺序

要理解 NEMU 的两层宏和 `MUXDEF`，记住下面几条简化规则就够了：

1. 识别到宏调用后，预处理器先收集实参；
2. 普通使用的实参通常先递归展开，再代入宏体；
3. 与 `#` 或 `##` 直接相邻的形参不会先展开；
4. 替换完成后，结果会再次被扫描，继续展开新出现的宏；
5. 正在展开的同名宏会暂时禁止递归展开，避免无限递归。

这套规则解释了 NEMU 为什么需要两层的字符串化和拼接：

```c
#define VALUE 42
#define str_temp(x) #x
#define str(x) str_temp(x)

str_temp(VALUE) // VALUE 被 # 挡住没有展开，得到 "VALUE"
str(VALUE)      // 外层先得到 str_temp(42)，再得到 "42"
```

它也解释了 X-macro 的机制：`MAP(NEMU_KEYS, NEMU_KEY_NAME)` 先拼出 `NEMU_KEYS(NEMU_KEY_NAME)`，重新扫描时再把整个键名列表展开。

宏的完整标准规则还要复杂一些，比如参数预扫描、不可用位标记等；不过读本项目时，上面五条已经足以解释绝大多数展开结果了。

### 2.11 查看预处理结果

遇到复杂的宏，最可靠的办法不是只在脑子里展开，而是让编译器停在预处理阶段：

```sh
gcc -E source.c          # 保留行标记的预处理结果
gcc -E -P source.c       # 去掉行标记，更适合阅读
gcc -dM -E source.c      # 输出该翻译单元最终可见的宏定义
```

NEMU 的编译需要项目自己的 `-I`、`-D__GUEST_ISA__=...` 等参数，可以先从构建命令里抄出真实的编译参数，再把其中的编译选项换成 `-E -P`。由于完整的预处理文件会夹杂大量系统头文件，查看展开结果时，建议直接搜索目标函数名或某条独特的 `INSTPAT` 执行语句。

## 3. `macro.h` 中的通用宏

文件：`nemu/include/macro.h`

### 3.1 字符串化：`str_temp`、`str`

```c
#define str_temp(x) #x
#define str(x) str_temp(x)
```

`#` 的作用是把宏实参变成字符串。这里故意套了两层宏：

```c
#define VALUE 42

str_temp(VALUE)  // "VALUE"
str(VALUE)       // "42"
```

第一层 `str` 让 `VALUE` 先展开为 `42`，第二层 `str_temp` 再把它字符串化。这个"双层展开"的技巧，后面的标识符拼接宏同样会用到。

### 3.2 编译期长度：`STRLEN`、`ARRLEN`

```c
#define STRLEN(CONST_STR) (sizeof(CONST_STR) - 1)
#define ARRLEN(arr) (int)(sizeof(arr) / sizeof(arr[0]))
```

- `STRLEN("abc")` 在编译期就能算出 `3`，减掉的是字符串末尾的 `\0`。
- `ARRLEN(a)` 用"整个数组的字节数除以单个元素的字节数"求出元素个数。

项目里的典型用途包括：

- `STRLEN(pattern)` 为指令模式字符串提供长度；
- `ARRLEN(rules)`、`ARRLEN(cmd_table)` 分别生成 SDB 的表达式规则数和命令数；
- `ARRLEN(name)` 检查 x86 段寄存器名字的下标。

使用时要注意边界：

- `STRLEN` 只适用于字符数组或字符串字面量；如果传入 `char *`，得到的是指针宽度减一，而不是字符串长度。
- `ARRLEN` 只适用于真正的数组；数组一旦作为函数形参就会退化成指针，此时结果就是错的。

### 3.3 标识符拼接：`concat` 系列

```c
#define concat_temp(x, y) x ## y
#define concat(x, y) concat_temp(x, y)
#define concat3(x, y, z) concat(concat(x, y), z)
// concat4、concat5 同理
```

`##` 把两个 token 拼成一个。两层定义是为了保证实参中的宏先展开：

```c
#define ISA riscv32
concat_temp(ISA, _CPU_state)  // ISA_CPU_state
concat(ISA, _CPU_state)       // riscv32_CPU_state
```

NEMU 里有两个关键用途：

1. `include/isa.h` 根据编译参数 `__GUEST_ISA__` 选择 ISA 类型：

   ```c
   typedef concat(__GUEST_ISA__, _CPU_state) CPU_state;
   typedef concat(__GUEST_ISA__, _ISADecodeInfo) ISADecodeInfo;
   ```

   例如 `__GUEST_ISA__` 是 `riscv32` 时，分别得到 `riscv32_CPU_state` 和 `riscv32_ISADecodeInfo`。

2. 各 ISA 的 `INSTPAT_MATCH` 用 `concat(TYPE_, type)` 把指令表中的短 token（如 `I`、`U`、`S`）拼成 `TYPE_I`、`TYPE_U`、`TYPE_S`。

`concat3`～`concat5` 是拼接更长标识符的组合工具，当前核心代码没有直接使用，但语义与 `concat` 相同。

### 3.4 根据布尔宏选择 token：`MUX*`

对外使用的宏是：

```c
#define MUXDEF(macro, X, Y)  ... // macro 定义为 0 或 1 时选 X，否则选 Y
#define MUXNDEF(macro, X, Y) ... // 与 MUXDEF 相反
#define MUXONE(macro, X, Y)  ... // macro 定义为 1 时选 X，否则选 Y
#define MUXZERO(macro, X, Y) ... // macro 定义为 0 时选 X，否则选 Y
```

它们的选择结果如下：

| `macro` 状态 | `MUXDEF(macro, X, Y)` | `MUXNDEF` | `MUXONE` | `MUXZERO` |
| --- | --- | --- | --- | --- |
| 未定义 | `Y` | `X` | `Y` | `Y` |
| 定义为 `0` | `X` | `Y` | `Y` | `X` |
| 定义为 `1` | `X` | `Y` | `X` | `Y` |

有一点需要注意：`MUXDEF` 只识别"展开后恰好为 `0` 或 `1`"的布尔宏，并不是通用的 `defined(...)`。比如宏被定义为 `2` 或者字符串时，`MUXDEF` 会把它当成不匹配。NEMU 的 Kconfig 布尔配置正好满足这个要求：启用的项在 `include/generated/autoconf.h` 中定义为 `1`，关闭的项通常不定义。

#### 内部实现原理

```c
#define CHOOSE2nd(a, b, ...) b
#define MUX_WITH_COMMA(contain_comma, a, b) CHOOSE2nd(contain_comma a, b)
#define MUX_MACRO_PROPERTY(p, macro, a, b) \
  MUX_WITH_COMMA(concat(p, macro), a, b)

#define __P_DEF_0  X,
#define __P_DEF_1  X,
#define __P_ONE_1  X,
#define __P_ZERO_0 X,
```

核心技巧是"看某个拼接结果是否展开出逗号"：

- 当 `MUXDEF(CONFIG_X, A, B)` 且 `CONFIG_X == 1` 时，`concat(__P_DEF_, 1)` 变成 `__P_DEF_1`，再展开为 `X,`，于是 `CHOOSE2nd(X, A, B)` 取到 `A`。
- 当 `CONFIG_X` 未定义时，拼接结果没有对应的定义，也就不会多出逗号，`CHOOSE2nd(某个普通token A, B)` 就取到 `B`。

这是一套纯预处理器技巧，`CHOOSE2nd`、`MUX_WITH_COMMA`、`MUX_MACRO_PROPERTY` 和 `__P_*` 都应视为内部实现，不建议在业务代码中直接调用。

#### NEMU 中的实际用途

`MUXDEF` 选中的不只是值，也可以是类型、字符串、声明乃至语句：

```c
typedef MUXDEF(CONFIG_ISA64, uint64_t, uint32_t) word_t;
#define FMT_WORD MUXDEF(CONFIG_ISA64, "0x%016" PRIx64, "0x%08" PRIx32)

int ilen_max = MUXDEF(CONFIG_ISA_x86, 8, 4);
MUXDEF(CONFIG_TARGET_AM, putch(ch), putc(ch, stderr));
```

正是靠这些宏，NEMU 才能用一份上层代码同时适配 32/64 位 ISA、不同的宿主目标和不同的设备配置。

### 3.5 把宏状态变成整数：`IS*` 与 `isdef`

```c
#define ISDEF(macro)  MUXDEF(macro, 1, 0)
#define ISNDEF(macro) MUXNDEF(macro, 1, 0)
#define ISONE(macro)  MUXONE(macro, 1, 0)
#define ISZERO(macro) MUXZERO(macro, 1, 0)
```

这四个宏把上一节的选择结果变成整数常量 `0` 或 `1`，适用范围也一样：只认值为 `0`/`1` 或未定义的布尔宏。

另外还有一个全小写的运行时版本：

```c
#define isdef(macro) (strcmp("" #macro, "" str(macro)) != 0)
```

它比较"宏名本身"和"宏展开结果"两个字符串：二者不同就认为宏已定义，因此能检测不止 `0`/`1` 的宏。但它有明确的限制：

- 它调用了 `strcmp()`，只能放在函数内部的 C 表达式环境里，替代不了 `#if defined(...)`；
- `#define A A` 这类自指宏会被误判为未定义；
- 判断发生在程序运行时，而 `ISDEF` 等通常能形成编译期常量。

当前 NEMU 核心代码没有直接使用这些 `IS*`/`isdef` 宏，它们主要作为通用设施保留。

### 3.6 条件保留代码：`IF*`

```c
#define __IGNORE(...)
#define __KEEP(...) __VA_ARGS__

#define IFDEF(macro, ...)  MUXDEF(macro, __KEEP, __IGNORE)(__VA_ARGS__)
#define IFNDEF(macro, ...) MUXNDEF(macro, __KEEP, __IGNORE)(__VA_ARGS__)
#define IFONE(macro, ...)  MUXONE(macro, __KEEP, __IGNORE)(__VA_ARGS__)
#define IFZERO(macro, ...) MUXZERO(macro, __KEEP, __IGNORE)(__VA_ARGS__)
```

`MUX*` 先选中 `__KEEP` 或 `__IGNORE`，再把可变参数传给对方，从而保留或删掉整段 token。这和运行时的 `if` 完全不同：没被选中的代码在预处理之后就不存在了。

典型的例子：

```c
typedef struct Decode {
  vaddr_t pc;
  vaddr_t snpc;
  vaddr_t dnpc;
  ISADecodeInfo isa;
  IFDEF(CONFIG_ITRACE, char logbuf[128]);
} Decode;

IFDEF(CONFIG_DIFFTEST, difftest_step(_this->pc, dnpc));
IFNDEF(CONFIG_TARGET_AM, setlocale(LC_NUMERIC, ""));
```

它们的效果分别是：只在 ITRACE 开启时给结构体加上日志缓冲区、只在差分测试开启时编译调用、只在非 AM 目标上设置 locale。

`include/memory/host.h` 里还有一个很能体现灵活性的例子：

```c
IFDEF(CONFIG_ISA64, case 8: return *(uint64_t *)addr);
default: MUXDEF(CONFIG_RT_CHECK, assert(0), return 0);
```

同一套宏既能往 `switch` 里插入 `case`，又能在"断言"和"返回默认值"之间做选择。

`IFONE`、`IFZERO` 目前没有被核心代码直接使用。内部的 `__KEEP`、`__IGNORE` 也不应该直接作为业务接口。

### 3.7 X-macro 映射：`MAP`

```c
#define MAP(c, f) c(f)
```

宏本身很简单，它想表达的是"把宏 `f` 应用到容器 `c` 的每个元素上"。容器要写成接收回调宏的列表：

```c
#define NEMU_KEYS(f) f(ESCAPE) f(F1) f(F2) /* ... */
#define NEMU_KEY_NAME(k) NEMU_KEY_ ## k,

enum {
  NEMU_KEY_NONE = 0,
  MAP(NEMU_KEYS, NEMU_KEY_NAME)
};
```

展开之后会生成：

```c
enum {
  NEMU_KEY_NONE = 0,
  NEMU_KEY_ESCAPE, NEMU_KEY_F1, NEMU_KEY_F2, /* ... */
};
```

同一份 `NEMU_KEYS` 还会通过 `SDL_KEYMAP` 展开成把 SDL 扫描码映射到 NEMU 键码的赋值语句。这样键名只需要维护一份，枚举和映射表就不会因为手工重复而失配。

### 3.8 位掩码、位段提取与符号扩展

```c
#define BITMASK(bits) ((1ull << (bits)) - 1)
#define BITS(x, hi, lo) (((x) >> (lo)) & BITMASK((hi) - (lo) + 1))
#define SEXT(x, len) \
  ({ struct { int64_t n : len; } __x = { .n = x }; (uint64_t)__x.n; })
```

#### `BITMASK(bits)`

生成低 `bits` 位全是 1 的掩码，比如 `BITMASK(5) == 0x1f`。

约束：底层的字面量是 64 位的 `1ull`，所以 `bits` 应在 `0..63` 范围内；左移 64 位在 C 里是未定义行为。

#### `BITS(x, hi, lo)`

提取 `x[hi:lo]`，上下界都包含，写法模仿 Verilog。例如：

```c
int rs1 = BITS(inst, 19, 15);
int rd  = BITS(inst, 11, 7);
```

这是 RISC-V、MIPS32 和 LoongArch32R 操作数译码的基础。

约束：应满足 `hi >= lo`，提取的宽度也不能达到 `BITMASK` 不支持的 64 位；`hi`、`lo` 不要传带副作用的表达式，因为参数可能被展开多次。

#### `SEXT(x, len)`

把 `x` 赋给宽度为 `len` 的有符号位域再读出来，从而把 `len` 位二进制数符号扩展到 64 位。返回类型被显式转成 `uint64_t`，负数以补码形式表现，赋给 `word_t` 后就保留目标 ISA 的字长。

例如 RISC-V 的 I 型立即数：

```c
*imm = SEXT(BITS(i, 31, 20), 12);
```

约束：

- 使用 GNU 语句表达式；
- `len` 是位域宽度，必须是编译期整型常量，且应在 `1..64` 范围内；
- 它依赖编译器对有符号位域的实现行为，适合本项目约定的 GCC/Clang 环境，不是完全可移植的 ISO C 写法。

### 3.9 地址对齐：`ROUNDUP`、`ROUNDDOWN`、`PG_ALIGN`

```c
#define ROUNDUP(a, sz)   ((((uintptr_t)a) + (sz) - 1) & ~((sz) - 1))
#define ROUNDDOWN(a, sz) (((uintptr_t)(a)) & ~((sz) - 1))
#define PG_ALIGN __attribute((aligned(4096)))
```

- `ROUNDUP(a, sz)`：把地址/整数向上对齐到 `sz` 的倍数；
- `ROUNDDOWN(a, sz)`：向下对齐；
- `PG_ALIGN`：要求编译器把对象按 4096 字节对齐。

`src/memory/paddr.c` 中静态物理内存数组的声明是：

```c
static uint8_t pmem[CONFIG_MSIZE] PG_ALIGN = {};
```

这样模拟物理内存就从页边界开始了。`ROUNDUP`、`ROUNDDOWN` 目前在 NEMU 核心代码中没有被直接调用。

对齐公式要求 `sz` 是正的 2 的幂，否则位掩码算法不成立；结果类型是 `uintptr_t`，需要指针时得再转换回去。`sz` 在宏里出现多次，同样不要传带副作用的表达式。

### 3.10 分支预测提示：`likely`、`unlikely`

```c
#define likely(cond)   __builtin_expect(cond, 1)
#define unlikely(cond) __builtin_expect(cond, 0)
```

它们不改变条件的真假，只是告诉编译器哪个结果更常见，方便编译器安排分支和指令布局。如果外部环境已经定义了 `likely`，代码里的 `#if !defined(likely)` 会避免重复定义。

物理地址访问的热路径是典型用法：

```c
if (likely(in_pmem(addr))) return pmem_read(addr, len);
```

大多数访存都落在普通物理内存上，MMIO 或越界是少见的路径。

### 3.11 Abstract Machine 设备 I/O：`io_read`、`io_write`

```c
#define io_read(reg) \
  ({ reg##_T __io_param; \
    ioe_read(reg, &__io_param); \
    __io_param; })

#define io_write(reg, ...) \
  ({ reg##_T __io_param = (reg##_T) { __VA_ARGS__ }; \
    ioe_write(reg, &__io_param); })
```

AM 为每个寄存器 `reg` 配套定义了一个 `reg_T` 参数结构体，宏通过 `##` 拿到这个类型，把创建参数结构体和传址的过程藏了起来：

```c
AM_TIMER_UPTIME_T t = io_read(AM_TIMER_UPTIME);
io_write(AM_GPU_FBDRAW, 0, 0, vmem, width, height, true);
```

- `io_read` 创建参数对象、调用 `ioe_read` 填充它，然后把结构体的值作为语句表达式的结果返回；
- `io_write` 用可变参数初始化对应的结构体，再传给 `ioe_write`。

这两个宏依赖 GNU 语句表达式和 AM 的命名约定，不能把任意变量名当 `reg` 传进去。

## 4. 配置宏如何贯穿 NEMU

### 4.1 配置来源

`nemu/Kconfig` 及子目录的 Kconfig 描述配置，生成的结果有两份：

- `.config`：面向 Kconfig/构建系统，例如 `CONFIG_ITRACE=y`；
- `include/generated/autoconf.h`：面向 C 编译器，例如 `#define CONFIG_ITRACE 1`。

布尔配置关闭时通常不会生成对应的 `#define`，而数值和字符串配置可能展开成别的 token，所以不要把所有的 `CONFIG_*` 都无条件传给只认布尔值的 `MUXDEF`。

项目里同时存在两种配置写法：

```c
#if defined(CONFIG_PMEM_MALLOC)
// 传统预处理指令
#endif

IFDEF(CONFIG_MEM_RANDOM, memset(pmem, rand(), CONFIG_MSIZE));
// NEMU 的 token 级条件保留
```

前者适合较大的多行分支，后者适合类型、表达式、成员或短语句里的局部选择。

### 4.2 字长和地址类型

`include/common.h` 用配置宏形成全局基础类型：

```c
typedef MUXDEF(CONFIG_ISA64, uint64_t, uint32_t) word_t;
typedef MUXDEF(CONFIG_ISA64, int64_t, int32_t) sword_t;

#if CONFIG_MBASE + CONFIG_MSIZE > 0x100000000ul
# define PMEM64 1
#endif
typedef MUXDEF(PMEM64, uint64_t, uint32_t) paddr_t;
```

- `word_t`/`sword_t` 跟随客户 ISA 的字长；
- `paddr_t` 跟随模拟物理地址的范围，物理内存上界超过 4 GiB 时就用 64 位；
- `FMT_WORD`、`FMT_PADDR` 同步选择正确的 `printf` 格式，避免类型与格式不匹配。

由此可以看出，"客户机寄存器宽度"和"客户机物理地址宽度"是两件独立的事。

### 4.3 ISA 类型和实现选择

`include/isa.h` 用 `concat` 把统一接口映射到具体的 ISA 类型。RISC-V 的 `isa-def.h` 又用 `MUXDEF` 来选择：

- RV32/RV64 的 CPU 状态和译码信息类型名；
- RVE 的 16 个通用寄存器还是普通 RISC-V 的 32 个通用寄存器。

各 ISA 的 `isa-def.h` 还定义了：

```c
#define isa_mmu_check(vaddr, len, type) (MMU_DIRECT)
```

当前骨架中的各 ISA 都用它把 MMU 检查直接替换成 `MMU_DIRECT`，`include/isa.h` 里的 `#ifndef isa_mmu_check` 因此会跳过同名函数声明。以后如果某个 ISA 需要真正的 MMU 检查，可以不定义这个快捷宏，转而实现函数。

## 5. 指令模式匹配宏 `INSTPAT`

文件：`nemu/include/cpu/decode.h`，各 ISA 的具体适配位于 `nemu/src/isa/*/inst.c`。

### 5.1 模式字符串如何变成 `key`、`mask`、`shift`

二进制模式由 `0`、`1`、`?` 和空格组成：

- `0`、`1`：该位必须匹配；
- `?`：不关心；
- 空格：只为了提高可读性，不占指令位。

`pattern_decode()` 扫描字符串并生成：

- `key`：固定为 1 的位；
- `mask`：需要参与比较的位；
- `shift`：模式末尾连续 `?` 的数量，用来去掉无须比较的低位。

最终匹配条件是：

```c
((instruction >> shift) & mask) == key
```

例如 x86 模式 `"1011 0???"` 表示高 5 位固定为 `10110`、低 3 位任意，适合一次描述一组"立即数写寄存器"的操作码。

`macro`、`macro2`、`macro4`、…、`macro64` 是 `pattern_decode` 内部手工展开的辅助宏：每一级把前一级调用两次，一次最多展开检查 64 个字符，用编译期展开代替运行时的循环结构。它们在函数末尾被 `#undef macro`，避免局部辅助名字泄漏；`macro2`～`macro64` 留在头文件作用域，但只服务于这一实现。

`pattern_decode_hex()` 是同一思路的十六进制模式解析器，最多展开 16 个字符；当前 `INSTPAT` 没有调用它，属于预留设施。

### 5.2 `INSTPAT` 的控制流

```c
#define INSTPAT(pattern, ...) do { \
  uint64_t key, mask, shift; \
  pattern_decode(pattern, STRLEN(pattern), &key, &mask, &shift); \
  if ((((uint64_t)INSTPAT_INST(s) >> shift) & mask) == key) { \
    INSTPAT_MATCH(s, ##__VA_ARGS__); \
    goto *(__instpat_end); \
  } \
} while (0)

#define INSTPAT_START(name) \
  { const void *__instpat_end = &&concat(__instpat_end_, name);
#define INSTPAT_END(name) \
  concat(__instpat_end_, name): ; }
```

工作流程如下：

1. `INSTPAT_START()` 创建结束标签的地址；
2. 每条 `INSTPAT` 解析并检查自己的模式；
3. 匹配后调用 ISA 自己定义的 `INSTPAT_MATCH`，完成操作数译码和执行；
4. 通过计算 goto 直接跳到 `INSTPAT_END()`，不再测试后面的模式。

所以**匹配遵循从上到下、首次命中优先**的原则。完全通配的非法指令模式必须放在末尾，否则它会遮蔽后面所有的指令。

`name` 参数用来给结束标签加后缀；当前代码以空参数调用，拼接结果是 `__instpat_end_`。标签地址和计算 goto 都是 GNU C 扩展。

### 5.3 `INSTPAT_INST`、`INSTPAT_MATCH` 是 ISA 适配接口

公共的 `INSTPAT` 并不知道指令存放在哪里、操作数怎么解码，所以要求每个 ISA 在使用前定义两个宏。

以 RISC-V 为例：

```c
#define INSTPAT_INST(s) ((s)->isa.inst)
#define INSTPAT_MATCH(s, name, type, ...) {             \
  int rd = 0;                                           \
  word_t src1 = 0, src2 = 0, imm = 0;                  \
  decode_operand(s, &rd, &src1, &src2, &imm,            \
                 concat(TYPE_, type));                  \
  __VA_ARGS__;                                          \
}
```

于是：

```c
INSTPAT("??????? ????? ????? 100 ????? 00000 11",
        lbu, I, R(rd) = Mr(src1 + imm, 1));
```

可以这样理解：

1. 模式命中 `lbu`；
2. `I` 被拼成 `TYPE_I`；
3. `decode_operand` 取出 `rd`、`rs1` 和 I 型立即数；
4. 执行体从 `src1 + imm` 读 1 个字节并写回 `rd`。

`name` 在当前精简骨架的 `INSTPAT_MATCH` 中没有被使用，但它保留了指令名的位置，便于更完整的实现用于日志、反汇编或统计。

### 5.4 各 ISA 的局部译码宏

这些宏故意依赖所在函数的局部变量，是组成译码 DSL 的"短词"，不应该当作通用 API。

#### RISC-V / MIPS32 / LoongArch32R

- `R(i)`：访问第 `i` 个通用寄存器；底层的 `gpr(idx)` 可以在 `CONFIG_RT_CHECK` 下检查下标。
- `Mr`、`Mw`：分别是 `vaddr_read`、`vaddr_write` 的短别名。
- `src1R()`、`src2R()`：从已取出的寄存器编号读取源操作数。
- `immI()`、`immU()`、`immS()`、`simm12()`、`simm20()`：用 `BITS` 和 `SEXT` 拼出不同格式的立即数。

每条指令最终都可以写成接近"模式 + 格式 + 语义"的一行，省去反复手写字段提取的功夫。

#### x86

- `Rr`/`Rw`：寄存器读写；`Mr`/`Mw`：虚拟地址读写。
- `RMr(reg, w)`：ModR/M 操作数是寄存器时读寄存器，否则读内存。
- `RMw(data)`：根据 ModR/M 结果写寄存器或内存；用 `do { ... } while (0)` 保持单语句语义。
- `destr`、`src1r`、`imm`、`simm`：填充目的寄存器、源值和立即数。
- `gp1()`：按 ModR/M 里的 opcode 扩展字段分派 group 1 指令；当前骨架只保留默认非法指令路径。
- `reg_l`、`reg_w`、`reg_b`：按 x86 编码规则访问 32/16/8 位寄存器视图。

x86 是变长指令，所以 `INSTPAT_INST(s)` 不是整个 `s->isa.inst`，而是当前取得的 8 位 `opcode`；`INSTPAT_MATCH` 还要处理操作数宽度前缀和 ModR/M。

## 6. 日志、断言和控制宏

### 6.1 ANSI 颜色和格式

`include/utils.h` 里的 `ANSI_FG_*`、`ANSI_BG_*` 和 `ANSI_NONE` 是终端转义序列。组合宏：

```c
#define ANSI_FMT(str, fmt) fmt str ANSI_NONE
```

会在字符串前加上颜色/样式，再在末尾恢复默认样式。它依赖 C 编译器自动拼接相邻字符串字面量的特性。

### 6.2 `_Log`、`log_write`、`Log`

- `log_write(...)`：只在 `CONFIG_TARGET_NATIVE_ELF` 下保留文件日志代码，并受 `log_enable()` 和 `log_fp` 控制；每次写入后都会刷新。
- `_Log(...)`：输出到控制台，同时尝试写日志文件。
- `Log(format, ...)`：在消息前加上蓝色的文件名、行号和函数名，末尾补一个换行。

`Log` 使用了编译器预定义的 `__FILE__`、`__LINE__`、`__func__` 宏，`##__VA_ARGS__` 让没有额外格式参数的调用也合法。`_Log` 会把参数分别交给控制台和文件输出，所以格式参数里不应出现自增、函数调用这类必须只执行一次的副作用。

### 6.3 `Assert`、`panic`、`TODO`

```c
#define panic(format, ...) Assert(0, format, ##__VA_ARGS__)
#define TODO() panic("please implement me")
```

`Assert` 在条件失败时会：

1. 根据目标选择 `printf` 或 `fprintf(stderr, ...)` 输出红色错误；
2. 非 AM 目标刷新日志文件；
3. 调用 `assert_fail_msg()` 打印寄存器和统计信息；
4. 最后触发标准的 `assert`。

外层用 `do { ... } while (0)` 包裹，让多语句宏在 `if/else` 中也表现为一条语句。断言条件失败后，会在 `if (!(cond))` 和 `assert(cond)` 里各求值一次，所以 `cond` 必须是无副作用的表达式。

`panic` 表示无条件失败；`TODO` 用于尚未实现的路径。

### 6.4 NEMU 状态快捷宏

`include/cpu/cpu.h`：

```c
#define NEMUTRAP(thispc, code) set_nemu_state(NEMU_END, thispc, code)
#define INV(thispc) invalid_inst(thispc)
```

- `NEMUTRAP` 把模拟器状态设为正常/异常结束，退出码由客户程序约定；
- `INV` 进入非法指令处理。

它们让不同 ISA 的指令表使用统一、简洁的执行语义。

## 7. 其他具名宏的分类

这一节的宏本身技巧不多，主要作用是用有业务含义的常量取代魔法数字。

### 7.1 内存与分页

文件 `include/memory/paddr.h`：

- `PMEM_LEFT`：模拟物理内存的起始地址，即 `CONFIG_MBASE`；
- `PMEM_RIGHT`：模拟物理内存最后一个有效字节的地址；
- `RESET_VECTOR`：CPU 复位取指地址。

文件 `include/memory/vaddr.h`：

- `PAGE_SHIFT = 12`；
- `PAGE_SIZE = 1 << PAGE_SHIFT`，即 4 KiB；
- `PAGE_MASK = PAGE_SIZE - 1`，用来取页内偏移。

`INTR_EMPTY` 把全 1 的 `word_t` 作为"当前没有待处理中断"的哨兵值。

### 7.2 调试器、执行器和设备容量

- `NR_REGEX`、`NR_CMD`：通过 `ARRLEN` 自动跟随规则表/命令表的长度；
- `NR_WP`：SDB 监视点池的容量；
- `MAX_INST_TO_PRINT`：单步执行数量小于该值时在屏幕上打印指令；
- `NR_MAP`：MMIO/PIO 映射表的容量；
- `IO_SPACE_MAX`、`PORT_IO_SPACE_MAX`：设备 I/O 空间的容量；
- `MAX_HANDLER`、`TIMER_HZ`：定时器回调容量和频率；
- `KEY_QUEUE_LEN`、`KEYDOWN_MASK`：键盘环形队列长度和按下事件标志；
- `SCREEN_W`、`SCREEN_H`：依据 VGA 配置选择模拟屏幕尺寸；
- `MEMORY_SIZE`、`BLOCK_LEN`、`NR_BLOCK` 等：SD 卡模型的容量和块布局推导。

`src/device/mmc.h` 里大量的 `MMC_*`、`R1_*`、`EXT_CSD_*` 宏是 MMC 协议的命令号、状态位和寄存器字段定义。它们属于协议常量表，阅读时应结合 MMC 规范，按"命令编号 / 状态位掩码 / EXT_CSD 字段"分类理解，而不是把它们当成 NEMU 的宏元编程机制。

### 7.3 差分测试 ABI

`include/difftest-def.h` 中：

- `__EXPORT` 展开为默认符号可见性属性，让差分测试共享库的接口能被动态加载器找到；
- `DIFFTEST_REG_SIZE` 根据 ISA 计算寄存器状态块的大小；
- `RISCV_GPR_TYPE`、`RISCV_GPR_NUM` 根据 RV32/RV64、RVE 配置选择寄存器的类型和数量。

这些宏共同约束了 DUT 与 REF 交换寄存器数据时的 ABI。

### 7.4 头文件保护宏

形如：

```c
#ifndef __COMMON_H__
#define __COMMON_H__
// ...
#endif
```

的宏只用来防止头文件在一个翻译单元里被重复包含，没有运行时语义，也不参与 NEMU 的模拟逻辑。

## 8. 阅读宏展开的推荐顺序

遇到一条指令或一段配置化代码时，可以按下面的顺序逐步展开：

1. 在 `include/generated/autoconf.h` 确认相关的 `CONFIG_*` 是 `1`、`0`、未定义，还是数值/字符串。
2. 展开 `MUXDEF`/`IFDEF`，先删掉当前配置下不存在的代码。
3. 展开 `concat` 和 ISA 局部短宏，如 `TYPE_`、`R`、`Mr`、`Mw`。
4. 对 `INSTPAT`，先把模式换算成 `key/mask/shift`，再看 ISA 的 `INSTPAT_MATCH`。
5. 最后检查 `BITS`/`SEXT` 得到的字段宽度、符号和目标 `word_t` 的字长。

以当前默认的 RISC-V 配置里的 `lbu` 为例，最终语义可以还原为：取 32 位指令 → 检查 opcode/funct3 → 读取 `rs1` → 对 12 位立即数做符号扩展 → 从 `rs1 + imm` 读一个字节 → 写入 `rd` → 跳过其余模式。

## 9. 宏使用时的常见陷阱

1. **数组退化**：不要对指针用 `ARRLEN`，也不要对 `char *` 用 `STRLEN`。
2. **参数重复求值**：`ROUNDUP` 的 `sz`、`BITS` 的边界参数、`Assert` 的失败条件等都可能被展开多次，不要传入 `i++` 之类的表达式。
3. **布尔宏范围**：`MUXDEF`/`IFDEF` 只按本实现识别 `0`、`1` 和未定义三种状态；字符串、普通整数配置要改用传统 `#if` 或其他方法。
4. **位宽边界**：`BITMASK(64)` 会产生非法移位；`SEXT` 的长度必须是合法的编译期位域宽度。
5. **对齐前提**：`ROUNDUP`/`ROUNDDOWN` 的 `sz` 必须是正的 2 的幂。
6. **首个模式优先**：`INSTPAT` 的通配规则必须放在最后。
7. **上下文耦合**：`R`、`RMw`、`src1R` 等局部 DSL 宏依赖特定的局部变量，只能在设计好的译码函数中使用。
8. **编译器依赖**：语句表达式、计算 goto、`__attribute__` 等都要求 GNU C 兼容的编译器和当前的构建选项。
9. **多语句宏结构**：写新的语句宏时优先采用 `do { ... } while (0)`，避免在外层 `if/else` 中产生语法歧义。

## 10. 总结

NEMU 的宏并不是零散的文本替换，而是一层叠一层的组合：

```text
Kconfig / CONFIG_*
        ↓
MUXDEF、IFDEF、concat
        ↓
统一的 word_t / CPU_state / 可选结构成员与代码
        ↓
BITS、SEXT、INSTPAT + 各 ISA 的 INSTPAT_MATCH
        ↓
简洁的指令译码与执行表
```

其中最值得掌握的设计有三个：

- 用"逗号探测"实现预处理阶段的布尔选择；
- 用双层字符串化/拼接控制宏实参的展开时机；
- 用 `INSTPAT`、X-macro 和 ISA 局部宏构造小型 DSL，减少重复代码，同时维持多 ISA 接口的一致。
