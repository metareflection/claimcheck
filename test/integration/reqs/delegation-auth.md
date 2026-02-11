# Delegation Auth Requirements

1. All granted capabilities reference existing subjects
2. Delegation endpoints (from, to) must be existing subjects
3. Edge IDs are always less than the next allocator (freshness)
4. Granting a capability to a non-existent subject is a no-op
5. Delegating between non-existent subjects is a no-op
6. Revoking a non-existent delegation is a no-op
