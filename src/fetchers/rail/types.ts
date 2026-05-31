export type RailDeparture = {
  departureCrs: string;
  departureName: string;
  destinationCrs: string;
  destinationName: string;
  scheduledDepartureTime: string;
  estimatedDepartureTime: string;
  cancelled: boolean;
  platform?: string | undefined;
  locationId: number;
};
