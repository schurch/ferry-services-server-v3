import type Database from "better-sqlite3";

export type WebsiteStats = {
  generatedAt: string;
  overview: {
    totalInstallations: number;
    pushEnabledInstallations: number;
    subscribedInstallations: number;
    totalSubscriptions: number;
    totalServices: number;
    normalServices: number;
    disruptedServices: number;
    cancelledServices: number;
  };
  deviceBreakdown: Array<{
    deviceType: "IOS" | "Android";
    count: number;
  }>;
  topSubscribedServices: Array<{
    serviceId: number;
    area: string;
    route: string;
    subscriberCount: number;
  }>;
  disruptionLeaders: Array<{
    serviceId: number;
    area: string;
    route: string;
    disruptedDays: number;
    cancelledDays: number;
    affectedDays: number;
  }>;
  dailyStatusTrend: Array<{
    observedDate: string;
    normalServices: number;
    disruptedServices: number;
    cancelledServices: number;
    observedServices: number;
  }>;
};

export function getWebsiteStats(db: Database.Database, now = new Date()): WebsiteStats {
  const today = now.toISOString().slice(0, 10);
  const trendStart = shiftDate(today, -13);
  const disruptionStart = shiftDate(today, -29);

  const overview = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM installations) AS total_installations,
      (SELECT COUNT(*) FROM installations WHERE push_enabled = 1) AS push_enabled_installations,
      (SELECT COUNT(DISTINCT installation_id) FROM installation_services) AS subscribed_installations,
      (SELECT COUNT(*) FROM installation_services) AS total_subscriptions,
      (SELECT COUNT(*) FROM services WHERE visible = 1) AS total_services,
      (SELECT COUNT(*) FROM services WHERE visible = 1 AND status = 0) AS normal_services,
      (SELECT COUNT(*) FROM services WHERE visible = 1 AND status = 1) AS disrupted_services,
      (SELECT COUNT(*) FROM services WHERE visible = 1 AND status = 2) AS cancelled_services
  `).get() as OverviewRow;

  const deviceBreakdown = db.prepare(`
    SELECT device_type, COUNT(*) AS count
    FROM installations
    GROUP BY device_type
    ORDER BY CASE device_type WHEN 'IOS' THEN 0 ELSE 1 END
  `).all() as DeviceRow[];

  const topSubscribedServices = db.prepare(`
    SELECT s.service_id, s.area, s.route, COUNT(DISTINCT links.installation_id) AS subscriber_count
    FROM services s
    JOIN installation_services links ON links.service_id = s.service_id
    WHERE s.visible = 1
    GROUP BY s.service_id, s.area, s.route
    HAVING subscriber_count > 0
    ORDER BY subscriber_count DESC, s.area ASC, s.route ASC
    LIMIT 8
  `).all() as ServiceCountRow[];

  const disruptionLeaders = db.prepare(`
    SELECT
      s.service_id,
      s.area,
      s.route,
      SUM(CASE WHEN r.status = 1 THEN 1 ELSE 0 END) AS disrupted_days,
      SUM(CASE WHEN r.status = 2 THEN 1 ELSE 0 END) AS cancelled_days,
      SUM(CASE WHEN r.status IN (1, 2) THEN 1 ELSE 0 END) AS affected_days
    FROM service_reliability_days r
    JOIN services s ON s.service_id = r.service_id
    WHERE s.visible = 1
      AND r.observed_date >= ?
      AND r.observed_date <= ?
    GROUP BY s.service_id, s.area, s.route
    HAVING affected_days > 0
    ORDER BY affected_days DESC, cancelled_days DESC, disrupted_days DESC, s.area ASC, s.route ASC
    LIMIT 8
  `).all(disruptionStart, today) as DisruptionRow[];

  const dailyRows = db.prepare(`
    SELECT
      observed_date,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS normal_services,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS disrupted_services,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS cancelled_services,
      COUNT(*) AS observed_services
    FROM service_reliability_days
    WHERE observed_date >= ?
      AND observed_date <= ?
    GROUP BY observed_date
    ORDER BY observed_date ASC
  `).all(trendStart, today) as DailyStatusRow[];

  const dailyLookup = new Map(dailyRows.map((row) => [row.observed_date, row]));
  const dailyStatusTrend = enumerateDates(trendStart, today).map((observedDate) => {
    const row = dailyLookup.get(observedDate);
    return {
      observedDate,
      normalServices: row?.normal_services ?? 0,
      disruptedServices: row?.disrupted_services ?? 0,
      cancelledServices: row?.cancelled_services ?? 0,
      observedServices: row?.observed_services ?? 0
    };
  });

  return {
    generatedAt: now.toISOString(),
    overview: {
      totalInstallations: overview.total_installations,
      pushEnabledInstallations: overview.push_enabled_installations,
      subscribedInstallations: overview.subscribed_installations,
      totalSubscriptions: overview.total_subscriptions,
      totalServices: overview.total_services,
      normalServices: overview.normal_services,
      disruptedServices: overview.disrupted_services,
      cancelledServices: overview.cancelled_services
    },
    deviceBreakdown: deviceBreakdown.map((row) => ({
      deviceType: row.device_type,
      count: row.count
    })),
    topSubscribedServices: topSubscribedServices.map((row) => ({
      serviceId: row.service_id,
      area: row.area,
      route: row.route,
      subscriberCount: row.subscriber_count
    })),
    disruptionLeaders: disruptionLeaders.map((row) => ({
      serviceId: row.service_id,
      area: row.area,
      route: row.route,
      disruptedDays: row.disrupted_days,
      cancelledDays: row.cancelled_days,
      affectedDays: row.affected_days
    })),
    dailyStatusTrend
  };
}

type OverviewRow = {
  total_installations: number;
  push_enabled_installations: number;
  subscribed_installations: number;
  total_subscriptions: number;
  total_services: number;
  normal_services: number;
  disrupted_services: number;
  cancelled_services: number;
};

type DeviceRow = {
  device_type: "IOS" | "Android";
  count: number;
};

type ServiceCountRow = {
  service_id: number;
  area: string;
  route: string;
  subscriber_count: number;
};

type DisruptionRow = {
  service_id: number;
  area: string;
  route: string;
  disrupted_days: number;
  cancelled_days: number;
  affected_days: number;
};

type DailyStatusRow = {
  observed_date: string;
  normal_services: number;
  disrupted_services: number;
  cancelled_services: number;
  observed_services: number;
};

function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return dates;
}
