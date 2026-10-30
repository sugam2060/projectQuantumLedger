import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const records = pgTable('records', {
  id: uuid('id').defaultRandom().primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
