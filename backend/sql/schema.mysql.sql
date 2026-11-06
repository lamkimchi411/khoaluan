CREATE TABLE IF NOT EXISTS brands (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  threshold DOUBLE NOT NULL DEFAULT 40,
  email VARCHAR(1000) NOT NULL DEFAULT '',
  telegram VARCHAR(1000) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  video_id VARCHAR(100) NOT NULL,
  brand_id BIGINT NOT NULL,
  caption TEXT, author VARCHAR(1000) NOT NULL DEFAULT '', author_nickname TEXT,
  views BIGINT, likes BIGINT, comment_count BIGINT, shares BIGINT, saves BIGINT,
  video_url VARCHAR(1000) NOT NULL DEFAULT '', sentiment TEXT, score DOUBLE,
  created_at VARCHAR(40) NOT NULL, observed_at VARCHAR(40), published_at VARCHAR(40),
  source VARCHAR(1000) NOT NULL DEFAULT 'live', collection_method TEXT, evidence_sha256 TEXT,
  hashtags TEXT, comment_status TEXT, discovery_keyword TEXT,
  UNIQUE(video_id, brand_id),
  FOREIGN KEY (brand_id) REFERENCES brands(id),
  INDEX posts_brand_created_idx (brand_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  post_id BIGINT NOT NULL,
  text TEXT NOT NULL, author VARCHAR(1000) NOT NULL DEFAULT '', author_nickname TEXT,
  parent_id TEXT, like_count BIGINT, sentiment TEXT, score DOUBLE,
  created_at VARCHAR(40) NOT NULL, published_at VARCHAR(40),
  PRIMARY KEY(id, post_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  brand_id BIGINT NOT NULL, reason TEXT NOT NULL,
  level TEXT NOT NULL, status VARCHAR(1000) NOT NULL DEFAULT 'open',
  created_at VARCHAR(40) NOT NULL, delivery VARCHAR(1000) NOT NULL DEFAULT 'Chỉ thông báo trong ứng dụng',
  FOREIGN KEY (brand_id) REFERENCES brands(id),
  INDEX alerts_brand_created_idx (brand_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  brand_id BIGINT NOT NULL, status TEXT NOT NULL,
  message TEXT, report TEXT, created_at VARCHAR(40) NOT NULL,
  finished_at VARCHAR(40),
  FOREIGN KEY (brand_id) REFERENCES brands(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crawl_schedules (
  brand_id BIGINT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT false,
  interval_minutes INTEGER NOT NULL DEFAULT 60, max_posts INTEGER NOT NULL DEFAULT 10,
  max_comments INTEGER NOT NULL DEFAULT 100, max_scrolls INTEGER NOT NULL DEFAULT 12,
  next_run_at VARCHAR(40), last_run_at VARCHAR(40), keyword_cursor INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (brand_id) REFERENCES brands(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL, role VARCHAR(30) NOT NULL, active BOOLEAN NOT NULL DEFAULT true
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, brand_id BIGINT NOT NULL, post_id BIGINT, comment_id VARCHAR(191), risk_score DOUBLE NOT NULL,
  severity VARCHAR(30) NOT NULL, queue VARCHAR(30) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'open', assignee_id BIGINT,
  created_at VARCHAR(40) NOT NULL, accepted_at VARCHAR(40), resolved_at VARCHAR(40), due_at VARCHAR(40) NOT NULL, escalated_at VARCHAR(40), resolution_note TEXT NOT NULL,
  FOREIGN KEY (brand_id) REFERENCES brands(id), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (assignee_id) REFERENCES staff(id), INDEX tickets_brand_status_idx (brand_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ticket_actions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, ticket_id BIGINT NOT NULL, actor VARCHAR(1000) NOT NULL, action VARCHAR(100) NOT NULL, detail TEXT NOT NULL, created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ticket_responses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, ticket_id BIGINT NOT NULL, content TEXT NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'approved',
  approved_by VARCHAR(1000) NOT NULL, approved_at VARCHAR(40) NOT NULL, published_at VARCHAR(40), publish_mode VARCHAR(30), published_url VARCHAR(1000),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




