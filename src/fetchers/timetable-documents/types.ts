export type ScrapedTimetableDocument = {
  organisationId: number;
  serviceIds: number[];
  title: string;
  sourceUrl: string;
  contentHash?: string | undefined;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  lastSeenAt: string;
};
