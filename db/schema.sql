CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  room_id UUID,
  amount NUMERIC NOT NULL,
  type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id VARCHAR(100),
  player_id VARCHAR(100) NOT NULL,
  result VARCHAR(10) NOT NULL,
  win_type VARCHAR(20),
  multiplier INT,
  pot_amount NUMERIC DEFAULT 0,
  hand_score INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id VARCHAR(100) PRIMARY KEY,
  total_games INT NOT NULL DEFAULT 0,
  wins_instant_kaeng INT NOT NULL DEFAULT 0,
  wins_tong INT NOT NULL DEFAULT 0,
  wins_flush_straight INT NOT NULL DEFAULT 0,
  total_losses INT NOT NULL DEFAULT 0,
  net_profit NUMERIC NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
