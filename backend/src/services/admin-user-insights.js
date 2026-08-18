/**
 * Platform adoption metrics for Admin → User Insights.
 * Counts login accounts (CEO companies + invited employees). Admins and known
 * test-name prefixes are excluded so leftover e2e users do not skew adoption.
 */
import { getDb } from '../db/schema.js';

/** Display-name prefixes from automated tests (not real company signups). */
export const INSIGHTS_EXCLUDE_NAME_PREFIXES = ['SR Import', 'Connector Test'];

const INACTIVE_AFTER_DAYS = 7;

function excludeNameSql(alias = '') {
  const col = alias ? `${alias}.name` : 'name';
  return INSIGHTS_EXCLUDE_NAME_PREFIXES.map(() => `${col} NOT LIKE ?`).join(' AND ');
}

function excludeNameParams() {
  return INSIGHTS_EXCLUDE_NAME_PREFIXES.map((p) => `${p}%`);
}

function count(db, sql, params = []) {
  try {
    return Number(db.prepare(sql).get(...params)?.n ?? 0);
  } catch (e) {
    console.warn('[user-insights] count skipped: %s', e?.message || e);
    return 0;
  }
}

function allRows(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    console.warn('[user-insights] list skipped: %s', e?.message || e);
    return [];
  }
}

function publicUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    role: row.role,
    enabled: !!row.enabled,
    created_at: row.created_at || null,
    last_login_at: row.last_login_at || null,
    days_idle: row.days_idle != null ? Number(row.days_idle) : null,
    industry: row.industry || '',
    business_name: row.business_name || '',
  };
}

/**
 * UTC windows: today (calendar day), this ISO week (Monday 00:00), this month.
 */
export function getAdminUserInsights() {
  const db = getDb();
  const ex = excludeNameSql();
  const exU = excludeNameSql('u');
  const xp = excludeNameParams();

  const peopleWhere = `role IN ('ceo', 'org_user') AND ${ex}`;
  const ceoWhere = `role = 'ceo' AND ${ex}`;
  const empWhere = `role = 'org_user' AND ${ex}`;

  const todayStart = `datetime(date('now'))`;
  const weekStart = `datetime(date('now', 'weekday 0', '-6 days'))`;
  const monthStart = `datetime(strftime('%Y-%m-01', 'now'))`;
  const inactiveBefore = `datetime('now', '-${INACTIVE_AFTER_DAYS} days')`;
  const newlyInactiveAfter = `datetime('now', '-${INACTIVE_AFTER_DAYS * 2} days')`;

  const lastUsed = `COALESCE(last_login_at, created_at)`;
  const inactivePred = `enabled = 1 AND datetime(${lastUsed}) < ${inactiveBefore}`;
  const activePred = `enabled = 1 AND last_login_at IS NOT NULL AND datetime(last_login_at) >= ${inactiveBefore}`;

  const registeredToday = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${peopleWhere} AND datetime(created_at) >= ${todayStart}`,
    xp
  );
  const registeredWeek = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${peopleWhere} AND datetime(created_at) >= ${weekStart}`,
    xp
  );
  const registeredMonth = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${peopleWhere} AND datetime(created_at) >= ${monthStart}`,
    xp
  );
  const inactive7d = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${peopleWhere} AND ${inactivePred}`,
    xp
  );
  const active7d = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${peopleWhere} AND ${activePred}`,
    xp
  );
  const newlyInactiveWeek = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users
     WHERE ${peopleWhere} AND enabled = 1
       AND last_login_at IS NOT NULL
       AND datetime(last_login_at) < ${inactiveBefore}
       AND datetime(last_login_at) >= ${newlyInactiveAfter}`,
    xp
  );

  const ceosEnabled = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${ceoWhere} AND enabled = 1`,
    xp
  );
  const ceosDisabled = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${ceoWhere} AND enabled = 0`,
    xp
  );
  const ceosToday = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${ceoWhere} AND datetime(created_at) >= ${todayStart}`,
    xp
  );
  const ceosWeek = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${ceoWhere} AND datetime(created_at) >= ${weekStart}`,
    xp
  );
  const employeesEnabled = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${empWhere} AND enabled = 1`,
    xp
  );
  const employeesToday = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${empWhere} AND datetime(created_at) >= ${todayStart}`,
    xp
  );
  const employeesWeek = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users WHERE ${empWhere} AND datetime(created_at) >= ${weekStart}`,
    xp
  );

  const neverLoggedIn = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users
     WHERE ${peopleWhere} AND enabled = 1 AND last_login_at IS NULL
       AND datetime(created_at) < datetime('now', '-1 day')`,
    xp
  );
  const loggedInOnce = count(
    db,
    `SELECT COUNT(*) AS n FROM platform_users
     WHERE ${ceoWhere} AND enabled = 1 AND last_login_at IS NOT NULL`,
    xp
  );
  const activationPct =
    ceosEnabled > 0 ? Math.round((loggedInOnce / ceosEnabled) * 1000) / 10 : 0;

  const crmEnabled = count(
    db,
    `SELECT COUNT(*) AS n FROM company_business_profiles p
     INNER JOIN platform_users u ON u.id = p.owner_user_id
     WHERE u.role = 'ceo' AND u.enabled = 1 AND ${exU}
       AND COALESCE(p.crm_provider, 'none') NOT IN ('none', '')`,
    xp
  );
  const erpEnabled = count(
    db,
    `SELECT COUNT(*) AS n FROM company_business_profiles p
     INNER JOIN platform_users u ON u.id = p.owner_user_id
     WHERE u.role = 'ceo' AND u.enabled = 1 AND ${exU}
       AND COALESCE(p.erp_provider, 'none') NOT IN ('none', '')`,
    xp
  );
  const companySetupDone = count(
    db,
    `SELECT COUNT(*) AS n FROM ceo_org_strategy s
     INNER JOIN platform_users u ON u.id = s.owner_user_id
     WHERE u.role = 'ceo' AND u.enabled = 1 AND ${exU}
       AND (
         json_extract(s.strategic_profile_json, '$.setup_gate') IN ('completed', 'skipped')
         OR s.status = 'applied'
       )`,
    xp
  );
  const connectorsLinked = count(
    db,
    `SELECT COUNT(*) AS n FROM openconnector_user_links l
     INNER JOIN platform_users u ON u.id = l.user_id
     WHERE u.role = 'ceo' AND u.enabled = 1 AND ${exU}
       AND l.linked_at IS NOT NULL AND TRIM(COALESCE(l.linked_at, '')) != ''`,
    xp
  );
  const companiesWithAgents = count(
    db,
    `SELECT COUNT(DISTINCT ua.user_id) AS n FROM user_agents ua
     INNER JOIN platform_users u ON u.id = ua.user_id
     WHERE ua.enabled = 1 AND u.role = 'ceo' AND u.enabled = 1 AND ${exU}`,
    xp
  );

  const industryMix = allRows(
    db,
    `SELECT COALESCE(NULLIF(TRIM(industry), ''), 'unset') AS industry, COUNT(*) AS n
     FROM platform_users
     WHERE ${ceoWhere} AND enabled = 1
     GROUP BY 1 ORDER BY n DESC, industry ASC LIMIT 8`,
    xp
  ).map((r) => ({ industry: r.industry, count: Number(r.n) }));

  const newest = allRows(
    db,
    `SELECT id, name, email, role, enabled, created_at, last_login_at, industry, business_name,
            CAST((julianday('now') - julianday(COALESCE(last_login_at, created_at))) AS INTEGER) AS days_idle
     FROM platform_users
     WHERE ${peopleWhere}
     ORDER BY datetime(created_at) DESC
     LIMIT 25`,
    xp
  ).map(publicUserRow);

  const inactive = allRows(
    db,
    `SELECT id, name, email, role, enabled, created_at, last_login_at, industry, business_name,
            CAST((julianday('now') - julianday(${lastUsed})) AS INTEGER) AS days_idle
     FROM platform_users
     WHERE ${peopleWhere} AND ${inactivePred}
     ORDER BY datetime(${lastUsed}) ASC
     LIMIT 100`,
    xp
  ).map(publicUserRow);

  const generatedAt = new Date().toISOString();
  console.info(
    '[user-insights] today=%s week=%s inactive_7d=%s active_7d=%s ceos=%s employees=%s',
    registeredToday,
    registeredWeek,
    inactive7d,
    active7d,
    ceosEnabled,
    employeesEnabled
  );

  return {
    generated_at: generatedAt,
    timezone: 'UTC',
    inactive_after_days: INACTIVE_AFTER_DAYS,
    exclude_name_prefixes: [...INSIGHTS_EXCLUDE_NAME_PREFIXES],
    kpis: {
      registered_today: registeredToday,
      registered_this_week: registeredWeek,
      registered_this_month: registeredMonth,
      inactive_7d: inactive7d,
      active_7d: active7d,
      newly_inactive_this_week: newlyInactiveWeek,
    },
    companies: {
      enabled: ceosEnabled,
      disabled: ceosDisabled,
      registered_today: ceosToday,
      registered_this_week: ceosWeek,
      logged_in_once: loggedInOnce,
      activation_pct: activationPct,
      company_setup_done: companySetupDone,
      crm_enabled: crmEnabled,
      erp_enabled: erpEnabled,
      connectors_linked: connectorsLinked,
      with_ai_employees: companiesWithAgents,
    },
    employees: {
      enabled: employeesEnabled,
      invited_today: employeesToday,
      invited_this_week: employeesWeek,
    },
    highlights: {
      never_logged_in: neverLoggedIn,
      industry_mix: industryMix,
    },
    newest,
    inactive,
  };
}
