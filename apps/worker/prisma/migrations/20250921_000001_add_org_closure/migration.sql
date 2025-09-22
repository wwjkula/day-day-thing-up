-- org_closure: 组织树闭包表（ancestor -> descendant, depth）
-- Neon / PostgreSQL

CREATE TABLE IF NOT EXISTS org_closure (
  ancestor_id   BIGINT NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  descendant_id BIGINT NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  depth         INT    NOT NULL,
  CONSTRAINT pk_org_closure PRIMARY KEY (ancestor_id, descendant_id)
);

-- 辅助索引：按后代查祖先或按祖先查所有后代
CREATE INDEX IF NOT EXISTS idx_org_closure_desc ON org_closure(descendant_id);

-- 初始全量构建（从 org_units(parent_id) 生成闭包关系）
WITH RECURSIVE t AS (
  -- 自反闭包（节点到自身，深度0）
  SELECT id AS ancestor_id, id AS descendant_id, 0 AS depth
  FROM org_units
  UNION ALL
  -- 直接父子（深度1）
  SELECT p.id AS ancestor_id, c.id AS descendant_id, 1 AS depth
  FROM org_units c
  JOIN org_units p ON c.parent_id = p.id
  UNION ALL
  -- 递推：祖先 → 孙辈/更深后代
  SELECT t.ancestor_id, c.id AS descendant_id, t.depth + 1 AS depth
  FROM t
  JOIN org_units c ON c.parent_id = t.descendant_id
)
INSERT INTO org_closure (ancestor_id, descendant_id, depth)
SELECT DISTINCT ancestor_id, descendant_id, depth
FROM t
ON CONFLICT (ancestor_id, descendant_id) DO NOTHING;

-- 验证样例
-- SELECT * FROM org_closure ORDER BY ancestor_id, depth, descendant_id LIMIT 50;

