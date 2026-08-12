export interface HealthIndicator {
  parameter: string;
  value: string;
  status: 'normal' | 'abnormal';
}

export interface Report {
  id: string;
  patient_name: string;
  age: number;
  location: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  indicators: HealthIndicator[];
  raw_analysis?: any;
  file_url?: string;
  created_at: string;
}

export interface Doctor {
  name: string;
  rating?: number;
  user_ratings_total?: number;
  address: string;
  phone?: string;
  website?: string;
  mapsUrl: string;
  aiRecommended?: boolean;
  aiReason?: string;
  distance_km?: number;
  lat?: number;
  lon?: number;
  isClosest?: boolean;
}
