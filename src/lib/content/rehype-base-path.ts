import { withBasePath } from "../site-path";

interface ContentNode {
  type: string;
  properties?: Record<string, unknown>;
  attributes?: Array<{ type: string; name?: string; value?: unknown }>;
  children?: ContentNode[];
}

const urlAttributes = new Set(["href", "src", "poster"]);

export function rehypeBasePath({ base }: { base: string }) {
  return (tree: ContentNode) => {
    const visit = (node: ContentNode) => {
      if (node.type === "element" && node.properties) {
        for (const name of urlAttributes) {
          const value = node.properties[name];
          if (typeof value === "string") node.properties[name] = withBasePath(value, base);
        }
      }
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        for (const attribute of node.attributes ?? []) {
          if (attribute.type === "mdxJsxAttribute" && urlAttributes.has(attribute.name ?? "")
            && typeof attribute.value === "string") {
            attribute.value = withBasePath(attribute.value, base);
          }
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
