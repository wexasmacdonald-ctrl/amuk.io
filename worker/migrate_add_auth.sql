create table if not exists accounts (
  id text primary key,
  handle text not null unique,
  password_hash text not null,
  password_salt text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists sessions (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_at text not null default (datetime('now')),
  expires_at integer not null
);

alter table queue add column account_id text;
create unique index if not exists queue_account_id_unique on queue (account_id);

alter table match_players add column account_id text;
create unique index if not exists match_players_account_id_unique on match_players (match_id, account_id);
