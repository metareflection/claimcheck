# Canon Requirements

1. All constraint targets reference existing nodes
2. All edge endpoints reference existing nodes
3. Adding a node with an existing ID is a no-op
4. Removing a node cleans up related constraints and edges
5. The constraint ID allocator is always fresh
