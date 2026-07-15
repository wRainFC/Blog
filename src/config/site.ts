export const siteConfig = {
  name: "楚地之雨",
  title: "楚地之雨｜wRainFC 的学习札记",
  description: "整理课程笔记，记录感悟与思考。一个克制、清晰的个人知识花园。",
  language: "zh-CN",
  rssTitle: "楚地之雨 RSS",
} as const;

export const navigation = [
  { href: "/learn", label: "课程笔记" },
  { href: "/writing", label: "随笔思考" },
  { href: "/about", label: "关于" },
] as const;
