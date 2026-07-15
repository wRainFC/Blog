export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function readingTime(body = ""): string {
  const chinese = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (body.replace(/[\u3400-\u9fff]/g, " ").match(/\b\w+\b/g) || [])
    .length;
  return `${Math.max(1, Math.ceil((chinese + words) / 350))} 分钟阅读`;
}
