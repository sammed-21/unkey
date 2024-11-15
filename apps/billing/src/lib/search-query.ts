import { db } from "@/lib/db-marketing/client";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { eq, sql } from "drizzle-orm";

import { entries, insertSearchQuerySchema, searchQueries } from "@/lib/db-marketing/schemas";

export async function getOrCreateSearchQuery(args: { term: string }) {
  const { term } = args;
  // Try to find existing search query
  const existingQuery = await db.query.searchQueries.findFirst({
    where: eq(searchQueries.inputTerm, term),
  });

  if (existingQuery) {
    // Ensure entry exists even for existing query
    await db
      .insert(entries)
      .values({
        inputTerm: term,
      })
      .onDuplicateKeyUpdate({
        set: {
          updatedAt: sql`now()`,
        },
      });
    return existingQuery;
  }

  // Generate new search query
  // NOTE: THE PROMPTING HERE REQUIRES SOME IMPROVEMENTS (ADD EVALS) -- FOR API RATE LIMITING IT GENERAATED:
  // "API Rate Limiting best practices and implementation", which is not the best keyword to search for.
  const generatedQuery = await generateObject({
    model: openai("gpt-4o-mini"),
    system: `You are a Senior Content Writer who specialises in writing technical content for Developer Tools that are SEO optimized.
For every term, you conduct a search on Google to gather the data you need.
You're goal is to create a search query that will return a SERP with the most relevant information for the term.

Make sure to always include the exact term in the search query at the beginning of the query.
If the term is clearly associated to API development, use the term as-is for query.

If the term is ambiguous with non-API development related fields and could result in unrelated results, add context to the search query to clarify the search & return the reason for the ambiguity.

Keep the search query as short and as simple as possible, don't use quotes around the search query.

`,
    prompt: `Create the search query for the term "${term}."`,
    schema: insertSearchQuerySchema.omit({ createdAt: true, updatedAt: true }),
  });

  // Create both search query and entry in a transaction
  await db.transaction(async (tx) => {
    // Insert search query
    await tx
      .insert(searchQueries)
      .values({
        ...generatedQuery.object,
      })
      .onDuplicateKeyUpdate({
        set: {
          updatedAt: sql`now()`,
        },
      });

    // Insert entry
    await tx
      .insert(entries)
      .values({
        inputTerm: term,
      })
      .onDuplicateKeyUpdate({
        set: {
          updatedAt: sql`now()`,
        },
      });
  });

  const insertedQuery = await db.query.searchQueries.findFirst({
    where: eq(searchQueries.inputTerm, generatedQuery.object.inputTerm),
  });

  if (!insertedQuery) {
    throw new Error("Failed to insert or update search query");
  }

  return insertedQuery;
}
