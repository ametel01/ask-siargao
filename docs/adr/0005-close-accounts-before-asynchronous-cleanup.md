# Close accounts before asynchronous cleanup

On a traveler-initiated closure or verified Clerk deletion, Ask Siargao will atomically record a
Closure Tombstone, create a durable Closure Operation, invalidate public shares and open usage
reservations, and establish a write barrier before acknowledging completion. Account access remains
denied from that point forward while Clerk deletion, Erasable Product Data removal, and Retained
Commerce Evidence minimization retry internally; this prioritizes immediate privacy and
non-resurrection without making a provider request wait for unbounded multi-table cleanup.
