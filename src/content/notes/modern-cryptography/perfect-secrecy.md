---
title: "现代密码学课程笔记 02：完美保密性"
summary: "从概率、条件概率和 Bayes 定理出发，形式化完美保密性，证明一次一密并说明 Shannon 定理及其限制。"
pubDate: 2026-10-27
course: modern-cryptography
chapter: chapter-02
order: 0
tags: ["密码学", "完美保密性", "一次一密"]
draft: false
---
# 现代密码学课程笔记 02：完美保密性

> 课程：南京大学 2025 秋季《现代密码学》
> 主讲：Sheng Zhong、Yuan Zhang
> 来源：2025 秋季《现代密码学》课程讲义。
> 对应内容：Perfect Secrecy（完美保密性）
> 对应教材：Katz and Lindell, *Introduction to Modern Cryptography*, Chapter 2
> 整理原则：合并动画叠页，保留定义、概率公式、构造、证明和限制条件

## 目录

- [一、从概率开始](#一从概率开始)
- [二、加密方案的形式化定义](#二加密方案的形式化定义)
- [三、完美保密性](#三完美保密性)
- [四、一次一密](#四一次一密)
- [五、完美保密性的限制](#五完美保密性的限制)
- [六、Shannon 定理](#六shannon-定理)
- [七、全章总结](#七全章总结)
- [八、复习自测](#八复习自测)
- [九、参考文献](#九参考文献)

## 一、从概率开始

密码学中的安全性经常被表述为概率事件。例如，攻击者看到密文后，消息是某个候选值的概率是否发生变化。因此需要先回顾概率、条件概率、独立性和 Bayes 定理。

课程用“十个问题”游戏引入这一点：讲授者心里选定一个省份，听课者最多问十个只能回答“是/否”的问题来猜测答案。每次提问都应根据当前信息更新候选省份的概率分布；密码分析中的猜测、更新和选择下一步攻击，本质上也在做类似的概率推理。

### 1. 样本空间与事件

一次试验的所有可能结果组成样本空间 $\Omega$。事件 $A$ 是 $\Omega$ 的任意子集。有限且等可能时，古典概率定义为：

$$
\Pr[A]=\frac{|A|}{|\Omega|}.
$$

例如掷一个均匀骰子，令 $X$ 为点数，则

$$
\Pr[X=6]=\frac16,\qquad \Pr[X\ge 5]=\frac26.
$$

当“结果有限”和“结果等可能”不成立时，可用重复试验的极限频率理解概率：若事件 $A$ 在 $n$ 次试验中发生 $n_A$ 次，则

$$
\Pr[A]=\lim_{n\to\infty}\frac{n_A}{n}.
$$

现代概率论则以 Kolmogorov 的测度公理体系为基础。

### 2. 条件概率与独立性

对 $\Pr[B]>0$，条件概率定义为：

$$
\Pr[A\mid B]=\frac{\Pr[A\cap B]}{\Pr[B]}.
$$

随机变量 $X,Y$ 相互独立，当且仅当对所有可能的 $x,y$：

$$
\Pr[X=x\land Y=y]=\Pr[X=x]\Pr[Y=y],
$$

等价地，

$$
\Pr[X=x\mid Y=y]=\Pr[X=x].
$$

多个变量的**相互独立**要求联合分布可分解为所有边缘分布的乘积；**两两独立**只要求任意两个变量独立，强度更弱，不能直接推出相互独立。

### 3. 全概率公式与 Bayes 定理

若互斥事件 $E_1,\ldots,E_n$ 构成样本空间的划分，则：

$$
\Pr[A]=\sum_{i=1}^{n}\Pr[A\mid E_i]\Pr[E_i].
$$

Bayes 定理为：

$$
\Pr[A\mid B]=\frac{\Pr[A]\Pr[B\mid A]}{\Pr[B]}.
$$

在密码学中，$A$ 往往表示“明文等于某个候选值”，$B$ 表示“观察到某个密文”。完美保密性正是要求观察到 $B$ 后，关于 $A$ 的概率不发生变化。

#### 一个 Bayes 例子：云天是否会下雨

设

$$
\Pr[\mathrm{Cloud}\mid\mathrm{Rain}]=0.5,
\quad \Pr[\mathrm{Cloud}]=0.4,
\quad \Pr[\mathrm{Rain}]=0.1.
$$

已知早晨多云，则：

$$
\Pr[\mathrm{Rain}\mid\mathrm{Cloud}]
=\frac{\Pr[\mathrm{Rain}]\Pr[\mathrm{Cloud}\mid\mathrm{Rain}]}{\Pr[\mathrm{Cloud}]}
=\frac{0.1\times0.5}{0.4}=0.125.
$$

这说明“下雨天通常多云”并不等价于“多云时通常下雨”；条件概率的方向不能混淆。

## 二、加密方案的形式化定义

一个对称加密方案 $\Pi=(\mathrm{Gen},\mathrm{Enc},\mathrm{Dec})$ 由有限消息空间 $\mathcal M$（$|\mathcal M|>1$）、密钥空间 $\mathcal K$ 和密文空间 $\mathcal C$ 指定：

- **密钥生成**：概率算法 $k\leftarrow\mathrm{Gen}$，按某个分布从 $\mathcal K$ 生成密钥，通常为均匀分布。
- **加密**：输入 $k\in\mathcal K,m\in\mathcal M$，输出 $c\leftarrow\mathrm{Enc}_k(m)$。加密算法可以是概率算法，也可以是确定算法。
- **解密**：确定算法 $m:=\mathrm{Dec}_k(c)$。

正确性要求对所有 $m$ 和由加密产生的 $c$：

$$
\mathrm{Dec}_k(\mathrm{Enc}_k(m))=m.
$$

### 例：移位密码

对单个字母，令 $\mathcal M=\mathcal C=\{0,\ldots,25\}$，密钥 $k\leftarrow\{0,\ldots,25\}$ 均匀生成：

$$
\mathrm{Enc}_k(m)=m+k\pmod{26},\qquad
\mathrm{Dec}_k(c)=c-k\pmod{26}.
$$

对长度为 3 的消息，若 $M=m_1\Vert m_2\Vert m_3$，则同一个 $k$ 被复用于每一位：

$$
C=(m_1+k)\Vert(m_2+k)\Vert(m_3+k)\pmod{26}.
$$

这正是后续分析中泄漏信息的来源。

## 三、完美保密性

### 1. 定义

> [!tip] **定义：完美保密性**
>
> 加密方案 $\Pi=(\mathrm{Gen},\mathrm{Enc},\mathrm{Dec})$ 在消息空间 $\mathcal M$ 上是完美保密的，如果对 $M$ 的**任意先验分布**、任意 $m\in\mathcal M$ 以及满足 $\Pr[C=c]>0$ 的任意 $c\in\mathcal C$，都有
>
> $$
> \Pr[M=m\mid C=c]=\Pr[M=m].
> $$

含义是：看到密文后，攻击者关于明文的概率分布完全不变。该定义对任意消息分布成立，因此不允许通过“消息本来很不均匀”来掩盖泄漏。

### 2. 移位密码的概率分析

对长度为 3 的移位密码，假设

$$
\Pr[M=\text{ann}]=0.6,\qquad \Pr[M=\text{bob}]=0.4.
$$

若观察到密文 `DQQ`，只有 `ann` 在某个合法密钥下能产生该密文，而 `bob` 不可能产生它。因此：

$$
\Pr[C=\text{DQQ}]=0.6\cdot\frac1{26}+0.4\cdot0=\frac3{130},
$$

并由 Bayes 定理得到：

$$
\Pr[M=\text{ann}\mid C=\text{DQQ}]=1\ne0.6.
$$

所以该方案不是完美保密的。

这个例子也说明了为什么不能只看密钥空间大小。长度为 3 的移位密码仍只有 26 个密钥，而且一个密钥同时作用于三个字符；某些密文只可能由某个消息产生，观察密文后先验概率会被彻底改变。

对单个字母的移位密码，若 $\Pr[M=b]=0.6,\Pr[M=g]=0.4$，观察到密文 `Z` 时：

$$
\Pr[C=Z]=0.6\cdot\frac1{26}+0.4\cdot\frac1{26}=\frac1{26},
$$

且

$$
\Pr[M=b\mid C=Z]=\frac{0.6\cdot(1/26)}{1/26}=0.6.
$$

这说明单个字母的移位密码在该消息空间上确实满足完美保密性。

### 3. 等价定义

> [!tip] **引理：密文分布独立于明文**
>
> 加密方案完美保密，当且仅当对任意 $m,m'\in\mathcal M$ 和 $c\in\mathcal C$：
>
> $$
> \Pr[C=c\mid M=m]=\Pr[C=c\mid M=m'].
> $$

也就是说，无论选择哪个明文，密文的概率分布都相同。证明方向如下：

- 若条件分布相同，代入 Bayes 公式并用全概率公式，可约去密文条件概率，得到 $\Pr[M=m\mid C=c]=\Pr[M=m]$。
- 若完美保密，对任意不同的 $m,m'$ 构造只在这两个消息间取值的先验分布，再用 Bayes 公式比较，即可推出两个条件分布相等。

### 4. 基于游戏的完美不可区分性

定义实验 $\mathrm{PrivK}^{\mathrm{eav}}_{\mathcal A,\Pi}$：

1. 对手 $\mathcal A$ 选择等长消息 $m_0,m_1$ 并发送给挑战者。
2. 挑战者生成 $k\leftarrow\mathrm{Gen}$，均匀选择 $b\in\{0,1\}$，计算 $c\leftarrow\mathrm{Enc}_k(m_b)$。
3. 挑战者把 $c$ 发送给 $\mathcal A$。
4. $\mathcal A$ 输出猜测 $b'$。
5. 若 $b'=b$，实验输出 1，否则输出 0。

随机猜测已经有 $1/2$ 的成功概率。若方案完美不可区分，则对任意对手：

$$
\Pr[\mathrm{PrivK}^{\mathrm{eav}}_{\mathcal A,\Pi}=1]=\frac12.
$$

完美保密与完美不可区分等价：密文分布若与明文无关，对手看不到关于 $b$ 的信息；反之，若存在密文分布差异，对手就可以选择一对消息利用该差异取得超过 $1/2$ 的成功率。

一个两字符、周期从 $\{1,2\}$ 中均匀选择的 Vigenère 方案不是完美不可区分的。对手选择 $m_0=\text{aa},m_1=\text{ab}$，若看到两字符密文相等则猜 $b'=0$，否则猜 $b'=1$。当 $b=0$ 时相等概率为 $1/2+1/(2\cdot26)$；综合两种 $b$ 后成功概率为 $0.75>1/2$。

这里的核心不是对手“破解出密钥”，而是对手只利用密文中是否出现某种结构，就能比随机猜测更准确。这也是现代密码学用游戏定义安全目标的原因：攻击成功可以是任何定义中规定的可观察区别，而不必限定为恢复完整明文或密钥。

## 四、一次一密

### 1. 构造

固定 $l>0$，令

$$
\mathcal M=\mathcal K=\mathcal C=\{0,1\}^l.
$$

一次一密（One-Time Pad, OTP，又称 Vernam cipher）：

1. $k\leftarrow\{0,1\}^l$ 均匀生成，因此 $\Pr[K=k]=2^{-l}$。
2. 加密：$C:=M\oplus K$。
3. 解密：$M:=C\oplus K$。

正确性来自 XOR 的结合律与 $K\oplus K=0$：

$$
C\oplus K=(M\oplus K)\oplus K=M.
$$

### 2. 完美保密性证明

对任意消息分布、任意 $m,c$：

$$
\begin{aligned}
\Pr[M=m\mid C=c]
&=\frac{\Pr[M=m]\Pr[C=c\mid M=m]}{\Pr[C=c]}\\
&=\frac{\Pr[M=m]\Pr[K=m\oplus c]}{\sum_{m'}\Pr[M=m']\Pr[K=m'\oplus c]}\\
&=\frac{\Pr[M=m]2^{-l}}{2^{-l}\sum_{m'}\Pr[M=m']}\\
&=\Pr[M=m].
\end{aligned}
$$

因此 OTP 是完美保密的。直观上，对任意给定的 $m,c$，都存在唯一密钥 $k=m\oplus c$；均匀密钥使所有明文产生给定密文的概率完全相同。

从等价条件看，固定任意明文 $m$ 和密文 $c$，恰有一个密钥 $k=m\oplus c$ 能把 $m$ 加密为 $c$，所以

$$
\Pr[C=c\mid M=m]=2^{-l}
$$

与 $m$ 无关。这是 OTP 完美保密的另一种更直接的证明。

## 五、完美保密性的限制

### 1. 密钥必须与消息一样长

OTP 的密钥长度为 $l$，消息长度也为 $l$。对于长消息，安全密钥分发和保存会成为主要成本。

### 2. 密钥只能使用一次

若重复使用同一个 $K$：

$$
C_1=M_1\oplus K,\qquad C_2=M_2\oplus K,
$$

则

$$
C_1\oplus C_2=M_1\oplus M_2.
$$

密钥被消去，两个明文之间的关系直接暴露，这称为 two-time pad 问题。

### 3. 只保证理想的密文窃听模型

完美保密性针对的是攻击者只观察密文的场景。若系统还需要抵抗篡改、选择明文或选择密文攻击，还必须额外设计完整性和认证机制。

此外，完美保密不隐藏消息长度、发送时机等侧信息；定义只约束消息空间和密文空间中被建模的内容。实际协议需要把这些额外泄漏也纳入威胁模型。

## 六、Shannon 定理

### 1. 完美保密的密钥空间下界

> [!tip] **定理：密钥空间下界**
>
> 若方案在消息空间 $\mathcal M$ 上完美保密，密钥空间为 $\mathcal K$，则
>
> $$
> |\mathcal K|\ge |\mathcal M|.
> $$

证明取消息均匀分布。存在某个 $c$ 使 $\Pr[C=c]>0$。完美保密要求对每个 $m$：

$$
\Pr[M=m\mid C=c]=\Pr[M=m]=1/|\mathcal M|>0.
$$

因此对每个 $m$，至少存在一个密钥 $k$ 使 $\mathrm{Dec}_k(c)=m$。不同 $m$ 需要不同密钥，于是 $|\mathcal K|\ge|\mathcal M|$。

### 2. Shannon 定理

> [!tip] **Shannon 定理**
>
> 当 $|\mathcal M|=|\mathcal C|=|\mathcal K|$ 时，方案完美保密，当且仅当：
>
> 1. $\mathrm{Gen}$ 以相同概率 $1/|\mathcal K|$ 选择每个密钥；
> 2. 对每个 $m\in\mathcal M$ 和 $c\in\mathcal C$，恰好存在一个密钥 $k$ 使 $\mathrm{Enc}_k(m)$ 输出 $c$。

OTP 满足这两个条件：密钥均匀生成，且对每个明文—密文对有唯一密钥 $k=m\oplus c$。Shannon 定理只适用于三个空间大小相等的情形，但可以快速判断许多有限方案是否完美保密。

Shannon 在 1949 年发表的 *Communication Theory of Secrecy Systems* 中系统研究了这种“不可破译”标准，并证明一次一密是满足完美保密条件的典型构造。定理的结论是信息论结论：只要满足条件，无限计算能力的攻击者也无法从密文获得关于明文的额外信息；它没有涉及实现成本、密钥分发或完整性保护。

## 七、全章总结

1. 完美保密要求密文不改变攻击者关于明文的任何先验概率。
2. 条件概率、全概率公式和 Bayes 定理是分析完美保密的基本工具。
3. 完美保密等价于不同明文诱导出相同的密文分布，也等价于完美不可区分。
4. OTP 用等长、均匀、只使用一次的密钥实现完美保密。
5. 完美保密的代价是密钥长度至少等于消息长度，且密钥不能复用。
6. Shannon 定理给出了等大小消息、密钥、密文空间下的判定条件。

## 八、复习自测

1. 为什么长度为 3 的移位密码会泄漏信息，而单个字母的移位密码可以完美保密？
2. 如何用 Bayes 定理证明 OTP 的完美保密性？
3. 为什么复用 OTP 密钥会暴露 $M_1\oplus M_2$？
4. 完美保密与完美不可区分的游戏定义有什么关系？
5. 为什么完美保密方案必须满足 $|\mathcal K|\ge|\mathcal M|$？
6. Shannon 定理的两个条件分别解决什么问题？

## 九、参考文献

1. Jonathan Katz, Yehuda Lindell, *Introduction to Modern Cryptography*, 2nd ed., Chapter 2, Chapman & Hall/CRC, 2014.
2. Sheng Zhong, Yuan Zhang, *Perfect Secrecy*, 2025 Fall Crypto Course, Nanjing University.
