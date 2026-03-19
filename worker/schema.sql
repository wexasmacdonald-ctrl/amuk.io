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

create table if not exists matches (
  id text primary key,
  status text not null default 'lobby' check (status in ('lobby','active','complete')),
  created_at text not null default (datetime('now')),
  started_at text null,
  ends_at text null,
  seed integer null
);

create table if not exists match_players (
  id text primary key,
  match_id text not null references matches(id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade,
  joined_at text not null default (datetime('now')),
  left_at text null,
  eliminated_at text null,
  gems integer not null default 0,
  placement integer null,
  unique(match_id, account_id)
);

create table if not exists queue (
  id text primary key,
  account_id text not null unique references accounts(id) on delete cascade,
  created_at text not null default (datetime('now'))
);
