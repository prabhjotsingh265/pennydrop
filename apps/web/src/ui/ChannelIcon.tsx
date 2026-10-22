import type { ChannelKind } from '@pennydrop/domain';
import { Hash, Mail, MessageCircle, Webhook } from 'lucide-react';

const ICONS = { email: Mail, slack: Hash, discord: MessageCircle, webhook: Webhook };

/** A channel's kind as an icon; its name always goes beside it. */
export function ChannelIcon({ kind, size = 16 }: { kind: ChannelKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} aria-hidden="true" />;
}
