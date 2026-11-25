import type {HistoryWire, SnapshotWire} from '../api';

/** Contract fixtures shaped exactly like backend/services/server/src/ind_server/serialization.py output. */
export const BTCB = '56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c';
export const ETH = '56:0x2170ed0880ac9a755fd29b2688956bd959f933f8';

export const snapshotFixture: SnapshotWire = {
  snapshot_at: '2026-11-25T18:36:00.004211+00:00',
  prices: [
    {asset_id: BTCB, feed_id: 632, price: '91234.123456789012345678', source_timestamp: 1795632958},
    {asset_id: ETH, feed_id: 641, price: '3105.5', source_timestamp: 1795632959},
  ],
};

export const historyFixture: HistoryWire = {
  snapshots: [
    {snapshot_at: '2026-11-25T18:35:00.001+00:00', prices: [{asset_id: BTCB, feed_id: 632, price: '91200', source_timestamp: 1795632898}]},
    {snapshot_at: '2026-11-25T18:36:00Z', prices: [{asset_id: BTCB, feed_id: 632, price: '91210.5', source_timestamp: 1795632958}]},
  ],
};
