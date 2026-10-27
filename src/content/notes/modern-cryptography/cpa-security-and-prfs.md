---
title: "现代密码学课程笔记 05：CPA 安全与伪随机函数"
summary: "从多重加密和 CPA 实验出发，介绍伪随机函数，并说明 PRF 如何构造 CPA 安全加密及其与 PRP、PRG 的关系。"
pubDate: 2026-10-27
updated: 2026-10-27
course: modern-cryptography
chapter: chapter-05
order: 0
tags: ["密码学", "CPA 安全", "伪随机函数"]
draft: false
---
# 现代密码学课程笔记 05：CPA 安全与伪随机函数

> 课程：南京大学 2025 秋季《现代密码学》
> 主讲：Sheng Zhong、Yuan Zhang
> 来源：2025 秋季《现代密码学》课程讲义。
> 对应内容：CPA Security and Pseudorandom Functions（CPA 安全与伪随机函数）
> 对应教材：Katz and Lindell, *Introduction to Modern Cryptography*, Chapter 3
> 整理原则：保留多重加密实验、CPA 定义、PRF 构造及其与 PRP/分组密码的关系

## 目录

- [一、为什么需要 CPA 安全](#一为什么需要-cpa-安全)
- [二、选择明文攻击](#二选择明文攻击)
- [三、伪随机函数](#三伪随机函数)
- [四、用 PRF 构造 CPA 安全加密](#四用-prf-构造-cpa-安全加密)
- [五、PRF、PRP 与分组密码](#五prfprp-与分组密码)
- [六、PRF 与 PRG 的关系](#六prf-与-prg-的关系)
- [七、全章总结](#七全章总结)
- [八、复习自测](#八复习自测)
- [九、参考文献](#九参考文献)

## 一、为什么需要 CPA 安全

### 单个密文与多个密文

EAV 实验只让对手观察一个挑战密文。但现实中同一个密钥会加密许多消息，因此需要定义多重加密实验：

1. 对手输出两组等长消息列表

$$
\vec M_0=(m_{0,1},\ldots,m_{0,t}),\qquad
\vec M_1=(m_{1,1},\ldots,m_{1,t});
$$

2. 挑战者生成同一个密钥 $k$，选择 $b\in\{0,1\}$，对所有 $i$ 计算 $c_i\leftarrow\mathrm{Enc}_k(m_{b,i})$；
3. 对手收到 $\vec C=(c_1,\ldots,c_t)$ 并输出 $b'$。

多重不可区分要求：

$$
\Pr[\mathrm{PrivK}^{\mathrm{mult}}_{\mathcal A,\Pi}(n)=1]
\le\frac12+\mathrm{negl}(n).
$$

这里所有 $c_i$ 使用同一个密钥，而不是每条消息重新生成密钥；实验因此能检验方案是否在长期使用中泄漏跨消息关系。

### 单次 EAV 安全不自动推出多重安全

用 PRG 构造的固定长度加密可以对单个密文 EAV 安全，但若同一个 pad 被多个消息复用，多个密文之间可能出现可检测关系。例如，若 PRG 只产生 3 位 pad，对手可以比较 `cat,cat` 与 `cat,dog` 的多组密文，发现同一 pad 引起的重复结构。

因此需要让每次加密都使用新的随机性，并给出能处理多次查询的更强定义。

## 二、选择明文攻击

### 选择明文攻击场景

选择明文攻击（Chosen-Plaintext Attack, CPA）允许对手控制或部分控制诚实方要加密的消息。它包含已知明文攻击，比单纯观察自然产生的密文更强。

CPA 实验 $\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\Pi}(n)$：

1. 挑战者运行 $k\leftarrow\mathrm{Gen}(1^n)$；
2. 对手获得输入 $1^n$，并可访问加密 oracle $\mathrm{Enc}_k(\cdot)$；
3. 对手提交等长消息 $m_0,m_1$；
4. 挑战者随机选 $b$，返回 $c\leftarrow\mathrm{Enc}_k(m_b)$；
5. 挑战后对手仍可访问加密 oracle，最终输出 $b'$。

### CPA 安全

> [!tip] **定义**
>
> 私钥加密方案 $\Pi$ 在选择明文攻击下安全，如果对任意 PPT 对手 $\mathcal A$，存在可忽略函数 $\mathrm{negl}$，使
>
> $$
> \Pr[\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\Pi}(n)=1]
> \le \frac12+\mathrm{negl}(n).
> $$

CPA 安全必须依赖概率性加密。确定性加密中，相同明文总产生相同密文，对手可以先查询某些候选明文，再直接比较挑战密文。

CPA 安全还隐含了消息长度处理问题：挑战消息通常要求等长，否则密文长度本身就可能泄漏 $b$。若系统需要隐藏长度，还要额外使用填充或长度隐藏机制。

一个重要结果是：**CPA 安全的单次加密自动推出 CPA 安全的多重加密**。证明依赖混合实验：把所有密文先选为 $\vec M_0$ 的加密，再依次把第 1、2、……、$t$ 个位置改成 $\vec M_1$ 的加密。若首尾两个混合分布能被区分，则至少有一个相邻混合分布能被以非可忽略优势区分；该相邻位置即可嵌入单次 CPA 挑战，从而矛盾。于是只需证明单次 CPA 安全，就能得到多重安全。

## 三、伪随机函数

### 为什么需要“随机函数”

PRG 输出看起来像随机字符串；若希望得到看起来像随机的函数，则使用伪随机函数（Pseudorandom Function, PRF）。随机函数允许对手多次查询同一个函数，并观察输入—输出关系。

### 函数与随机函数

函数是从 $\{0,1\}^{l_{in}}$ 到 $\{0,1\}^{l_{out}}$ 的映射。长度保持时输入输出长度相同。记

$$
\mathrm{Func}_n=\{f:\{0,1\}^n\to\{0,1\}^n\}.
$$

其函数总数为

$$
|\mathrm{Func}_n|=(2^n)^{2^n}=2^{n2^n}.
$$

均匀随机函数 $f$ 是从这个巨大集合中均匀选择的函数；它可以被想象为一个随机查找表。

### 带密钥函数与 PRF

带密钥函数为：

$$
F:\{0,1\}^{l_{key}}\times\{0,1\}^{l_{in}}\to\{0,1\}^{l_{out}}.
$$

固定密钥 $k$ 后得到单输入函数 $F_k(x)=F(k,x)$。若 $k$ 均匀随机时，$F_k$ 与均匀随机函数在 PPT 区分器看来不可区分，则 $F$ 是 PRF。

> [!tip] **定义：PRF**
>
> 对任意 PPT 区分器 $D$，存在可忽略函数 $\mathrm{negl}$，使
>
> $$
> \left|\Pr[D^{F_k(\cdot)}(1^n)=1]
> -\Pr[D^{f(\cdot)}(1^n)=1]\right|\le\mathrm{negl}(n),
> $$
>
> 其中 $k\leftarrow\{0,1\}^n$ 均匀选择，$f\leftarrow\mathrm{Func}_n$ 均匀选择。

PRF 的安全性允许区分器进行多项式次 oracle 查询，并适用于自适应选择查询输入。

与 PRG 的区别是：PRG 只有一次输出，区分器直接查看一个字符串；PRF 的区分器可以不断输入 $x$，观察 $F_k(x)$，因此需要保证整个带密钥函数的行为都像一个随机查找表。对同一个输入重复查询时，PRF 和随机函数都会返回同一个输出，这种一致性是函数结构的一部分。

## 四、用 PRF 构造 CPA 安全加密

### 构造

设 $F$ 是 PRF，消息长度和输入输出均为 $n$ 位：

- **Gen**：输入 $1^n$，均匀选择 $k\in\{0,1\}^n$；
- **Enc**：输入 $m\in\{0,1\}^n$，均匀选 $r\in\{0,1\}^n$，输出

$$
c=\langle r,s\rangle,\qquad s=F_k(r)\oplus m;
$$

- **Dec**：对 $c=\langle r,s\rangle$，输出

$$
m=F_k(r)\oplus s.
$$

$r$ 是公开随机数，关键是每次加密都以随机 $r$ 访问 PRF，得到新 pad $F_k(r)$。

### CPA 安全证明思路

构造替代方案 $\widetilde\Pi$：只把 PRF $F_k$ 替换成真正随机函数 $f$。由 PRF 定义，对任意 PPT 对手：

$$
\left|\Pr[\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\Pi}=1]
 -\Pr[\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\widetilde\Pi}=1]\right|
\le\mathrm{negl}(n).
$$

在 $\widetilde\Pi$ 中，如果所有查询的随机 $r$ 都与挑战 $r^*$ 不同，则 $f(r^*)$ 是一段对手未知、均匀随机的 pad，挑战密文与 $m_0,m_1$ 无关，对手只能以 $1/2$ 成功。若有某次查询命中 $r^*$，对手可能获得额外信息，但至多有 $q(n)$ 次查询，每次命中概率 $2^{-n}$，由并合界：

$$
\Pr[\text{至少一次命中}]\le\frac{q(n)}{2^n}.
$$

因此

$$
\Pr[\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\widetilde\Pi}=1]
\le\frac12+\frac{q(n)}{2^n}.
$$

合并两部分：

$$
\Pr[\mathrm{PrivK}^{\mathrm{cpa}}_{\mathcal A,\Pi}=1]
\le\frac12+\frac{q(n)}{2^n}+\mathrm{negl}(n),
$$

右侧额外项可忽略，所以构造 CPA 安全。

严格地说，随机函数游戏中的“命中”事件包括某个 oracle 查询使用挑战随机数 $r^*$；若没有命中，$f(r^*)$ 从未在其他位置出现，因而仍是独立均匀的 $n$ 位串。这个“先证明无命中时完全安全，再单独界定坏事件概率”的写法是密码学混合证明的常见模式。

## 五、PRF、PRP 与分组密码

### 伪随机置换

置换是双射 $f:\{0,1\}^n\to\{0,1\}^n$。记所有置换的集合为 $\mathrm{Perm}_n$，其大小为：

$$
|\mathrm{Perm}_n|=(2^n)!.
$$

带密钥置换 $F_k$ 若对每个 $k$ 都是可逆且高效可计算，并且对 PPT 区分器而言与均匀随机置换不可区分，则称为伪随机置换（PRP）。

### PRP 何时也是 PRF

若 PRP 的块长足够大，具体地，当 $l_{in}\ge n$ 时，它也是 PRF。直观上，随机函数和随机置换唯一明显的区别是：随机函数可能出现碰撞 $f(x)=f(y)$，而置换不会。对手进行 $q(n)$ 次查询时，出现碰撞的概率至多约为

$$
\frac{q(n)(q(n)-1)}{2^{n+1}},
$$

当 $q$ 为多项式且 $n$ 足够大时可忽略，因此对手无法有效区分两者。

### 强伪随机置换

若对手除了访问 $F_k(\cdot)$，还可以访问逆函数 $F_k^{-1}(\cdot)$，仍然无法与随机置换及其逆区分，则称 $F$ 为**强伪随机置换**（strong PRP）。它更贴近需要同时执行加密和解密的实际系统。

普通 PRP 的区分器只有正向 oracle；强 PRP 的区分器有两个 oracle，并且必须遵守它们作为同一置换及其逆的关系，因此强 PRP 是更强的安全要求。

分组密码通常被设计为固定密钥长度、固定块长度的强 PRP/PRF 实例。AES 等成熟分组密码的安全目标正是让其行为尽可能接近随机置换。

## 六、PRF 与 PRG 的关系

### PRF 构造 PRG

给定 PRF $F$，对种子 $s$ 定义：

$$
G(s)=F_s(1)\Vert F_s(2)\Vert\cdots\Vert F_s(l).
$$

由于对手无法区分 $F_s$ 与随机函数，拼接出的输出也看起来像随机串。

这里的输入 $1,2,\ldots,l$ 可以用固定长度二进制编码；只要不同位置使用不同编码，PRF 在不同输入上的输出就能提供不同的伪随机块。

### PRG 构造 PRF

若有扩展长度为 $n\cdot2^{t(n)}$ 的 PRG $G(k)=y_0y_1\ldots$，可把输入 $x\in\{0,1\}^n$ 看作索引，定义

$$
F_k(x)=y_{x\cdot t(n)}\,y_{x\cdot t(n)+1}\cdots y_{x\cdot t(n)+t(n)-1}.
$$

也就是说，用 PRG 输出的不同区块作为不同输入的函数值。这说明 PRG 与 PRF 在计算安全理论中紧密相关。

该构造需要足够长的 PRG 输出，以便为所有 $2^n$ 个输入预留一个长度为 $t(n)$ 的区块；实际实现通常使用更精巧的树状扩展，避免显式生成指数长度字符串。这一关系主要用于说明原语之间的可转换性。

## 七、全章总结

1. CPA 对手可以查询加密 oracle，安全性必须覆盖多次、主动选择的加密请求。
2. 概率性加密和每次新鲜的随机性是 CPA 安全的基础。
3. PRF 让带密钥函数在多次查询下看起来像真正随机函数。
4. 用 $\langle r,F_k(r)\oplus m\rangle$ 构造的加密方案是 CPA 安全的。
5. PRP/强 PRP 是分组密码的理想化安全目标；块长足够大时 PRP 也可视为 PRF。
6. PRF 与 PRG 可以相互构造，形成现代对称密码原语的基础。

## 八、复习自测

1. 为什么 EAV 安全不能直接覆盖多条密文？
2. CPA 实验中挑战前后为什么都允许加密 oracle 查询？
3. PRF 与真正随机函数的区别是什么？
4. 构造 $\langle r,F_k(r)\oplus m\rangle$ 中公开的 $r$ 起什么作用？
5. 为什么随机函数与随机置换的差别主要体现在碰撞上？
6. 强 PRP 比普通 PRP 多允许对手做什么？

## 九、参考文献

1. Jonathan Katz, Yehuda Lindell, *Introduction to Modern Cryptography*, 2nd ed., Chapter 3, Chapman & Hall/CRC, 2014.
2. Sheng Zhong, Yuan Zhang, *CPA Security and Pseudorandom Functions*, 2025 Fall Crypto Course, Nanjing University.
