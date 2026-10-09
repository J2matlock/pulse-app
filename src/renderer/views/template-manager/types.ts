export interface SetupTemplate {
  id: number
  name: string
  description: string | null
  pulse_json: string
  is_system: 0 | 1
  created_at: string
}
