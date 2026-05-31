export type ScrapedService = {
  serviceId: number;
  area: string;
  route: string;
  status: 0 | 1 | 2 | -99;
  sourceStatus?: string | undefined;
  sourceServiceId?: string | undefined;
  sourceServiceCode?: string | undefined;
  sourceAreaId?: string | undefined;
  sourceAreaName?: string | undefined;
  sourceAreaLatitude?: number | undefined;
  sourceAreaLongitude?: number | undefined;
  additionalInfo?: string | undefined;
  disruptionReason?: string | undefined;
  organisationId: number;
  lastUpdatedDate?: string | undefined;
  updated: string;
  notices?: ScrapedServiceNotice[] | undefined;
};

export type ScrapedServiceNotice = {
  sourceNoticeKey?: string | undefined;
  sourceNoticeType?: string | undefined;
  title: string;
  disruptionReason?: string | undefined;
  detailText?: string | undefined;
  detailMarkdown?: string | undefined;
};
