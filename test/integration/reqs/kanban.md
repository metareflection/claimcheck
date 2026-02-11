# Kanban Requirements

1. Column names are unique (no duplicate columns)
2. Every card appears in exactly one column (exact partition)
3. No card ID appears twice across all lanes (no duplicates)
4. Each column respects its WIP limit (number of cards does not exceed the limit)
5. Adding a card to a full column is a no-op
6. The card allocator is always fresh (no allocated ID reused)
7. Lanes and WIP maps are defined exactly for existing columns
8. Moving a card preserves the total number of cards
