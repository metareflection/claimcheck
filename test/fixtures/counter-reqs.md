# Counter Domain Requirements

1. The counter value is always non-negative
2. The initial state satisfies the invariant
3. Every action (increment or decrement) preserves the invariant after normalization
4. Decrementing at zero keeps the counter at zero
5. The counter never exceeds 100
