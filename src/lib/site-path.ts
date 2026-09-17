const basePrefix = (base: string) => {
  const path = base.replace(/^\/+|\/+$/g, "");
  return path ? `/${path}` : "";
};

export function withBasePath(path: string, base = import.meta.env.BASE_URL): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const prefix = basePrefix(base);
  const pathname = path.split(/[?#]/, 1)[0];
  if (!prefix || pathname === prefix || pathname.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}

export function withoutBasePath(pathname: string, base = import.meta.env.BASE_URL): string {
  const prefix = basePrefix(base);
  if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return pathname.slice(prefix.length) || "/";
  }
  return pathname;
}
