CREATE UNIQUE INDEX trip_pass_refund_operations_active_provider_order_idx
  ON trip_pass_refund_operations(order_id, provider, provider_order_id)
  WHERE status IN ('pending', 'running');
