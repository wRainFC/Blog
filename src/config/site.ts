export const siteConfig = {
  name: "楚地之雨",
  title: "楚地之雨｜wRainFC 的学习札记",
  description: "整理课程、技术与日常思考。一个清晰、克制、持续生长的个人知识索引。",
  language: "zh-CN",
  rssTitle: "楚地之雨 RSS",
} as const;

export const navigation = [
  { href: "/learn", label: "学习" },
  { href: "/writing", label: "写作" },
  { href: "/about", label: "关于" },
] as const;
