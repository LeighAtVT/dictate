// Dictate v2, Task 11: what main/pill.ts sends the pill window over IPC channel 'pill', passed on
// by preload/pill.ts and drawn by renderer/pill/Pill.tsx. Type only, so the sandboxed preload
// still requires nothing but 'electron'.
export interface PillMessage {
  text: string
  listening: boolean
}
