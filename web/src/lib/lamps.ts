import type { PlanWindow, SystemStats } from '@kitt/hub/protocol'

export type LampInputs = {
  voiceOn: boolean
  listening: boolean
  connected: boolean
  planStatus: PlanWindow['status']
  system: SystemStats | null
  tasksRunning: number
  terminalsOnline: number
}

export type Lamp = {
  id: 'voice' | 'mic' | 'link' | 'plan' | 'disk' | 'aux' | 'satcom' | 'load' | 'mem' | 'api'
  label: string
  side: 'left' | 'right'
  tone: 'yellow' | 'red'
  lit: boolean
  detail?: string
}

/** The ten lamps around the voice matrix. Yellow lamps are controls or activity; red lamps are alarms. */
export function deriveLamps(i: LampInputs): Lamp[] {
  const s = i.system
  return [
    { id: 'voice', label: 'Voice', side: 'left', tone: 'yellow', lit: i.voiceOn },
    { id: 'mic', label: 'Mic', side: 'left', tone: 'yellow', lit: i.listening },
    { id: 'link', label: 'Link', side: 'left', tone: 'red', lit: !i.connected },
    { id: 'plan', label: 'Plan', side: 'left', tone: 'red', lit: i.planStatus !== 'allowed' },
    { id: 'disk', label: 'Disk', side: 'left', tone: 'red', lit: s !== null && s.diskUsed > 0.9 },
    { id: 'aux', label: 'Aux', side: 'right', tone: 'yellow', lit: i.tasksRunning > 0, ...(i.tasksRunning > 0 ? { detail: String(i.tasksRunning) } : {}) },
    { id: 'satcom', label: 'Sat Comm', side: 'right', tone: 'yellow', lit: i.terminalsOnline > 0, ...(i.terminalsOnline > 0 ? { detail: String(i.terminalsOnline) } : {}) },
    { id: 'load', label: 'Load', side: 'right', tone: 'red', lit: s !== null && s.load > 0.8 },
    { id: 'mem', label: 'Mem', side: 'right', tone: 'red', lit: s !== null && s.memUsed > 0.9 },
    { id: 'api', label: 'API', side: 'right', tone: 'red', lit: s !== null && s.apiMs !== null && s.apiMs > 30_000 },
  ]
}
