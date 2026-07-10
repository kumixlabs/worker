import { describeRoute } from "hono-openapi";

/**
 * Returns a hono-openapi route descriptor with standard worker API response codes.
 *
 * @param tag - OpenAPI tag grouping (e.g. "Sources").
 * @param summary - Short operation summary.
 * @param description - Longer operation description.
 * @param status - Success status code (default 200).
 */
export function doc(tag: string, summary: string, description: string, status = 200) {
  return describeRoute({
    tags: [tag],
    summary,
    description,
    responses: {
      [status]: { description: summary },
      400: { description: "Bad request" },
      401: { description: "Invalid Kumix Worker token" },
      404: { description: "Resource not found" },
      409: { description: "Resource conflict" },
      429: { description: "Rate limited" },
    },
  });
}
