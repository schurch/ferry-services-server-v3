export type Location = {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type WeatherObservation = {
  description: string;
  icon: string;
  temperature: number;
  windSpeed: number;
  windDirection: number;
};
