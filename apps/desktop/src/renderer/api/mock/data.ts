/**
 * Synthetic demo seed from spec section 16. Fictional people only. No real PHI, ever.
 */
import type {
  AuditRow,
  Citation,
  DashboardResponse,
  Finding,
  Interpretation,
  MedicationRequest,
  Note,
  Observation,
  Patient,
  PatientSummary,
  Permission,
  Provenance,
  Report,
  Role,
  SourceRecord,
  User
} from '../types'

const now = new Date()
const iso = (d: Date): string => d.toISOString()
const todayAt = (h: number, m: number): string => {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return iso(d)
}
const daysFromNow = (n: number): string => iso(new Date(now.getTime() + n * 86_400_000))
const minutesAgo = (n: number): string => iso(new Date(now.getTime() - n * 60_000))

export const IDS = {
  gregory: '6f1c2a10-0000-4000-8000-000000000001',
  linda: '6f1c2a10-0000-4000-8000-000000000002',
  priya: '6f1c2a10-0000-4000-8000-000000000003',
  gregoryFinding: '9a0b7c20-0000-4000-8000-000000000001',
  gregorySlide: '9a0b7c20-0000-4000-8000-0000000000a1'
} as const

export const DEMO_PASSWORD = 'asclep-demo'

/** Gateway returns only User; email/provider/care_team are mock-internal (login lookup, RBAC). */
export type MockUser = User & { email: string; provider: string; care_team: string[] | 'all' | 'none' }

export const USERS: MockUser[] = [
  {
    id: 'u-admin',
    email: 'admin@asclep.demo',
    full_name: 'Jordan Kim',
    role: 'admin',
    provider: 'Northside',
    care_team: 'none'
  },
  {
    id: 'u-reyes',
    email: 'reyes@asclep.demo',
    full_name: 'Dr. Maya Reyes',
    role: 'physician',
    provider: 'Northside',
    care_team: 'all'
  },
  {
    id: 'u-okafor',
    email: 'okafor@asclep.demo',
    full_name: 'Ada Okafor, RN',
    role: 'nurse',
    provider: 'Northside',
    care_team: 'all'
  },
  {
    id: 'u-lab',
    email: 'lab@asclep.demo',
    full_name: 'Sam Patel',
    role: 'lab_staff',
    provider: 'Northside',
    care_team: 'none'
  },
  {
    id: 'u-wu',
    email: 'wu@asclep.demo',
    full_name: 'Dr. Henry Wu',
    role: 'physician',
    provider: 'Northside',
    care_team: [IDS.linda, IDS.priya]
  }
]

/** Mirrors services/api/app/rbac/permissions.py (roles with any scope). Scope is enforced separately. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'authenticated',
    'view_demographics',
    'record_consent',
    'view_inventory',
    'view_audit',
    'manage_users'
  ],
  physician: [
    'authenticated',
    'view_dashboard',
    'view_demographics',
    'view_labs',
    'view_notes',
    'view_restricted',
    'run_lab_technician',
    'review_findings',
    'request_transcripts',
    'use_ask',
    'view_inventory',
    'start_scribe',
    'review_scribe',
    'view_audit',
    'emergency_access'
  ],
  nurse: [
    'authenticated',
    'view_dashboard',
    'view_demographics',
    'view_labs',
    'view_notes',
    'use_ask',
    'view_inventory',
    'start_scribe',
    'view_audit'
  ],
  scribe: ['authenticated', 'view_demographics', 'view_notes', 'view_audit'],
  lab_staff: ['authenticated', 'view_demographics', 'run_lab_technician', 'view_inventory', 'view_audit']
}

const prov = (source_system: string, source_ref: string, minsAgo = 60): Provenance => ({
  source_system,
  source_ref,
  ingested_at: minutesAgo(minsAgo)
})

export const PATIENTS: Record<string, Patient> = {
  [IDS.gregory]: {
    id: IDS.gregory,
    name: 'Gregory Hale',
    age: 64,
    sex: 'M',
    mrn: 'NS-004417',
    allergies: [],
    allergy_status: 'unknown',
    sources: [{ source_system: 'ehr-b', label: 'Northside', status: 'current' }]
  },
  [IDS.linda]: {
    id: IDS.linda,
    name: 'Linda Morales',
    age: 71,
    sex: 'F',
    mrn: 'NS-002981',
    allergies: [],
    allergy_status: 'none_known',
    sources: [{ source_system: 'ehr-b', label: 'Northside', status: 'current' }]
  },
  [IDS.priya]: {
    id: IDS.priya,
    name: 'Priya Shah',
    age: 58,
    sex: 'F',
    mrn: 'NS-003350',
    allergies: [],
    allergy_status: 'none_known',
    sources: [{ source_system: 'ehr-b', label: 'Northside', status: 'current' }]
  }
}

/**
 * Source providers a transcript can be requested from, keyed by the from_provider_id the UI sends.
 * SPEC-QUESTION: no provider list route yet (see useRequestTranscript in api/hooks.ts).
 */
export const TRANSCRIPT_PROVIDERS: Record<string, string> = { riverside: 'Riverside Family Medicine' }
/** FHIR resources a Riverside pull imports per patient (Gregory: 10 years of labs, notes, meds). */
export const RIVERSIDE_RESOURCES: Record<string, number> = { [IDS.gregory]: 214 }

/** Applied when the Riverside transcript merges (demo step 3). */
export const GREGORY_AFTER_MERGE: Pick<Patient, 'allergies' | 'allergy_status' | 'sources'> = {
  allergies: [{ substance: 'Penicillin', provenance: prov('ehr-a', 'AllergyIntolerance/rv-221', 1) }],
  allergy_status: 'recorded',
  sources: [
    { source_system: 'ehr-b', label: 'Northside', status: 'current' },
    { source_system: 'ehr-a', label: 'Riverside', status: 'merged' }
  ]
}

export const SUMMARY_BEFORE: PatientSummary = {
  conditions: [{ display: 'Lung mass, under workup', provenance: prov('ehr-b', 'Condition/ns-88') }],
  medications: [],
  allergies: [],
  last_encounter: {
    date: daysFromNow(-6),
    reason: 'Referral: CT chest, lung biopsy',
    provenance: prov('ehr-b', 'Encounter/ns-1201')
  },
  new_from_sources: []
}

export const SUMMARY_AFTER: PatientSummary = {
  conditions: [
    { display: 'Lung mass, under workup', provenance: prov('ehr-b', 'Condition/ns-88') },
    { display: 'COPD', provenance: prov('ehr-a', 'Condition/rv-12', 1) },
    { display: 'Former smoker, 40 pack-years', provenance: prov('ehr-a', 'Observation/rv-smk-1', 1) }
  ],
  medications: [
    {
      display: 'Albuterol inhaler PRN',
      inventory_status: 'in_stock',
      provenance: prov('ehr-a', 'MedicationRequest/rv-77', 1)
    }
  ],
  allergies: [{ substance: 'Penicillin', provenance: prov('ehr-a', 'AllergyIntolerance/rv-221', 1) }],
  last_encounter: {
    date: daysFromNow(-6),
    reason: 'Referral: CT chest, lung biopsy',
    provenance: prov('ehr-b', 'Encounter/ns-1201')
  },
  new_from_sources: [
    {
      text: 'Penicillin allergy documented by Riverside. No allergy entry in the Northside records.',
      source_system: 'ehr-a',
      kind: 'gap'
    },
    { text: 'COPD and 40 pack-year smoking history, 10 years of labs.', source_system: 'ehr-a', kind: 'gap' }
  ]
}

export const DASHBOARD: DashboardResponse = {
  attention: [
    {
      id: 'a1',
      patient_id: IDS.linda,
      patient_name: 'Linda Morales',
      problem: 'Potassium 6.4 mmol/L (critical)',
      source: 'Northside lab',
      severity: 'critical',
      action_label: 'Review',
      action_target: 'patient'
    },
    {
      id: 'a2',
      patient_id: IDS.priya,
      patient_name: 'Priya Shah',
      problem: 'Pembrolizumab backordered',
      source: 'Inventory',
      severity: 'warning',
      action_label: 'View',
      action_target: 'inventory'
    },
    {
      id: 'a3',
      patient_id: IDS.gregory,
      patient_name: 'Gregory Hale',
      problem: 'Biopsy slide ready to analyze',
      source: 'Northside pathology',
      severity: 'info',
      action_label: 'Analyze',
      action_target: 'lab'
    }
  ],
  schedule: [
    {
      id: 's1',
      patient_id: IDS.gregory,
      patient_name: 'Gregory Hale',
      starts_at: todayAt(10, 30),
      reason: 'Results visit',
      status: 'scheduled'
    },
    {
      id: 's2',
      patient_id: IDS.linda,
      patient_name: 'Linda Morales',
      starts_at: todayAt(11, 15),
      reason: 'Follow-up',
      status: 'scheduled'
    },
    {
      id: 's3',
      patient_id: IDS.priya,
      patient_name: 'Priya Shah',
      starts_at: todayAt(13, 0),
      reason: 'Infusion planning',
      status: 'scheduled'
    }
  ],
  tasks: [
    {
      id: 't1',
      kind: 'analyze_slide',
      title: "Gregory's slide is ready",
      detail: 'Analyze the lung biopsy specimen.',
      patient_id: IDS.gregory
    },
    {
      id: 't2',
      kind: 'review_transcript',
      title: 'Request Riverside records',
      detail: 'Gregory was referred from Riverside.',
      patient_id: IDS.gregory
    },
    {
      id: 't3',
      kind: 'sign_report',
      title: 'Co-sign Linda follow-up note',
      detail: 'Drafted by Ada Okafor, RN.',
      patient_id: IDS.linda
    }
  ],
  recent_patients: [
    {
      patient_id: IDS.gregory,
      name: 'Gregory Hale',
      context: 'Northside referral / Results visit',
      opened_at: minutesAgo(40)
    },
    { patient_id: IDS.linda, name: 'Linda Morales', context: 'Follow-up', opened_at: minutesAgo(180) }
  ],
  supply_watch: [
    {
      medication: 'Pembrolizumab 100 mg/4 mL',
      on_hand: 0,
      backordered: true,
      expected_restock: daysFromNow(6)
    },
    { medication: 'Pemetrexed 500 mg', on_hand: 3, backordered: false, expected_restock: daysFromNow(2) }
  ]
}

export const CITATIONS: Record<string, Citation> = {
  'c-finding': {
    id: 'c-finding',
    kind: 'finding',
    label: 'Finding',
    object_id: IDS.gregoryFinding,
    provenance: prov('asclep', 'Finding/' + IDS.gregoryFinding, 2)
  },
  'c-smoking': {
    id: 'c-smoking',
    kind: 'observation',
    label: 'Smoking history',
    object_id: 'o-smk',
    provenance: prov('ehr-a', 'Observation/rv-smk-1', 1)
  },
  'c-copd': {
    id: 'c-copd',
    kind: 'condition',
    label: 'COPD history',
    object_id: 'cond-copd',
    provenance: prov('ehr-a', 'Condition/rv-12', 1)
  },
  'c-pembro': {
    id: 'c-pembro',
    kind: 'inventory',
    label: 'Pembrolizumab stock',
    object_id: 'inv-pembro',
    provenance: prov('asclep', 'Inventory/pembrolizumab', 5)
  }
}

export const SOURCE_RECORDS: Record<string, SourceRecord> = {
  'c-finding': {
    citation: CITATIONS['c-finding']!,
    title: 'Lab Technician finding',
    body: 'Lung biopsy, H&E. Model label LUAD (adenocarcinoma), confidence 0.87. Status: pending physician review.',
    recorded_at: minutesAgo(2)
  },
  'c-smoking': {
    citation: CITATIONS['c-smoking']!,
    title: 'Social history: tobacco',
    body: 'Former smoker. 40 pack-years. Quit 2019. Recorded by Riverside Family Medicine (Dr. One).',
    recorded_at: daysFromNow(-900)
  },
  'c-copd': {
    citation: CITATIONS['c-copd']!,
    title: 'Problem list: COPD',
    body: 'Chronic obstructive pulmonary disease, GOLD 2. Onset 2017. Riverside Family Medicine.',
    recorded_at: daysFromNow(-3000)
  },
  'c-pembro': {
    citation: CITATIONS['c-pembro']!,
    title: 'Inventory: Pembrolizumab 100 mg/4 mL',
    body: 'On hand: 0. Backordered. Expected restock in 6 days.',
    recorded_at: minutesAgo(5)
  }
}

export const GREGORY_FINDING: Finding = {
  id: IDS.gregoryFinding,
  patient_id: IDS.gregory,
  slide_id: IDS.gregorySlide,
  specimen_label: 'Lung biopsy, RUL',
  label: 'LUAD',
  label_display: 'LUAD / adenocarcinoma',
  confidence: 0.87,
  model_name: 'CONCH',
  model_version: 'conch_ViT-B-16@hf',
  flags: [],
  status: 'pending_review',
  final_label: null,
  review_note: null,
  reviewed_by: null,
  reviewed_at: null,
  thumbnail_url: null,
  heatmap_url: null,
  tile_urls: [],
  provenance: prov('asclep', 'Finding/' + IDS.gregoryFinding, 2)
}

export const GREGORY_REPORT: Report = {
  id: 'r-1',
  finding_id: IDS.gregoryFinding,
  status: 'draft',
  sentences: [
    { text: 'Finding: LUAD (adenocarcinoma); model confidence 87%.', citation_ids: ['c-finding'] },
    { text: 'Relevant context: former smoker, 40 pack-years.', citation_ids: ['c-smoking'] },
    { text: 'History of COPD recorded by Riverside.', citation_ids: ['c-copd'] }
  ],
  citations: [CITATIONS['c-finding']!, CITATIONS['c-smoking']!, CITATIONS['c-copd']!]
}

/** Canned Scribe windows (observable-only wording, spec 10.5). */
export const SCRIBE_SCRIPT = [
  [
    {
      category: 'mobility',
      text: 'Walked from the door to the chair; paused twice on the way',
      confidence: 0.82
    }
  ],
  [{ category: 'respiratory', text: 'Breathing visibly faster after sitting down', confidence: 0.71 }],
  [{ category: 'cough', text: 'Coughed 3 times, covered mouth with right hand', confidence: 0.9 }],
  [],
  [{ category: 'posture', text: 'Sat leaning forward with hands on knees', confidence: 0.66 }],
  [{ category: 'cough', text: 'Coughed 2 times', confidence: 0.88 }]
] as const

/**
 * LiveScribing conversation, one entry per 10-second window, aligned with SCRIBE_SCRIPT. Offsets are seconds
 * into the window. Mirrors MOCK_SCRIPT in services/resident/app/live_scribe.py; keep the two in sync.
 */
export const LIVE_TRANSCRIPT_SCRIPT: readonly (readonly [number, number, string])[][] = [
  [
    [2, 6, 'Good morning, Gregory. How have you been feeling since your last visit?'],
    [6, 10, 'Honestly, not great. I get short of breath walking up the stairs.']
  ],
  [
    [1, 4, 'How long has that been going on?'],
    [5, 10, "About three weeks. And this cough won't go away."]
  ],
  [
    [1, 4, 'Any chest pain, or coughing up blood?'],
    [5, 9, 'Some chest pain when I cough. No blood.']
  ],
  [
    [1, 5, 'Have you noticed any weight loss or fevers?'],
    [5, 9, "I've lost maybe eight pounds. No fevers."]
  ],
  [[1, 7, "I'm more tired than usual too. I nap every afternoon now."]],
  [[1, 6, "Okay. Let's listen to your lungs and go over your recent results."]]
]

export const AUDIT_SEED: AuditRow[] = [
  {
    id: 'au1',
    at: minutesAgo(45),
    actor_name: 'Dr. Maya Reyes',
    actor_kind: 'user',
    on_behalf_of: null,
    action: 'read',
    object_type: 'patient',
    patient_name: 'Gregory Hale',
    allowed: true,
    ran_on: null
  },
  {
    id: 'au2',
    at: minutesAgo(44),
    actor_name: 'Resident',
    actor_kind: 'resident',
    on_behalf_of: 'Dr. Maya Reyes',
    action: 'read',
    object_type: 'observation',
    patient_name: 'Gregory Hale',
    allowed: true,
    ran_on: 'anthropic_api'
  },
  {
    id: 'au3',
    at: minutesAgo(30),
    actor_name: 'Dr. Henry Wu',
    actor_kind: 'user',
    on_behalf_of: null,
    action: 'read',
    object_type: 'patient',
    patient_name: 'Gregory Hale',
    allowed: false,
    ran_on: null
  }
]

// ---- Labs. Northside has only the referral workup; Riverside adds 10 yearly panels on merge.
interface LabDef {
  loinc: string
  display: string
  unit: string
  low: number
  high: number
}
const LAB = {
  hgb: { loinc: '718-7', display: 'Hemoglobin', unit: 'g/dL', low: 13.5, high: 17.5 },
  wbc: { loinc: '6690-2', display: 'WBC', unit: '10*3/uL', low: 4.0, high: 11.0 },
  creat: { loinc: '2160-0', display: 'Creatinine', unit: 'mg/dL', low: 0.7, high: 1.3 },
  cea: { loinc: '2039-6', display: 'CEA', unit: 'ng/mL', low: 0, high: 5.0 },
  k: { loinc: '2823-9', display: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.1 }
} satisfies Record<string, LabDef>

function lab(def: LabDef, value: number, at: string, source: string, ref: string): Observation {
  const interp: Interpretation =
    value > def.high * 1.2 ? 'HH' : value > def.high ? 'H' : value < def.low ? 'L' : 'N'
  return {
    id: `obs-${ref}`,
    category: 'laboratory',
    loinc_code: def.loinc,
    display: def.display,
    value_num: value,
    value_text: null,
    unit: def.unit,
    ref_low: def.low,
    ref_high: def.high,
    interpretation: interp,
    effective_at: at,
    provenance: prov(source, `Observation/${ref}`)
  }
}

export const GREGORY_LABS_NORTHSIDE: Observation[] = [
  lab(LAB.hgb, 13.1, daysFromNow(-6), 'ehr-b', 'ns-l1'),
  lab(LAB.wbc, 9.8, daysFromNow(-6), 'ehr-b', 'ns-l2'),
  lab(LAB.creat, 1.0, daysFromNow(-6), 'ehr-b', 'ns-l3'),
  lab(LAB.cea, 6.8, daysFromNow(-6), 'ehr-b', 'ns-l4')
]

const yearly = (def: LabDef, values: number[], key: string): Observation[] =>
  values.map((v, i) => lab(def, v, daysFromNow(-365 * (values.length - i) - 20), 'ehr-a', `rv-${key}-${i}`))

export const GREGORY_LABS_RIVERSIDE: Observation[] = [
  ...yearly(LAB.hgb, [15.2, 15.0, 15.1, 14.8, 14.6, 14.7, 14.3, 14.1, 13.9, 13.6], 'hgb'),
  ...yearly(LAB.wbc, [7.1, 7.4, 6.9, 7.8, 8.2, 7.6, 8.4, 8.8, 8.5, 9.1], 'wbc'),
  ...yearly(LAB.creat, [0.9, 0.9, 1.0, 0.9, 1.0, 1.0, 0.9, 1.0, 1.1, 1.0], 'creat'),
  ...yearly(LAB.cea, [2.1, 2.3, 2.2, 2.6, 2.5, 2.9, 3.1, 3.4, 3.6, 4.2], 'cea')
]

export const LINDA_LABS: Observation[] = [
  lab(LAB.k, 4.8, daysFromNow(-90), 'ehr-b', 'ns-k1'),
  lab(LAB.k, 5.3, daysFromNow(-14), 'ehr-b', 'ns-k2'),
  lab(LAB.k, 6.4, minutesAgo(180), 'ehr-b', 'ns-k3')
]

// ---- Medication orders with inventory (spec 16 inventory seed)
export const GREGORY_MEDS_RIVERSIDE: MedicationRequest[] = [
  {
    id: 'mr-rv-77',
    medication: 'Albuterol inhaler 90 mcg',
    status: 'active',
    dosage_text: '2 puffs every 4-6 hours as needed',
    effective_at: daysFromNow(-1400),
    inventory: { status: 'in_stock', on_hand: 40, expected_restock_at: null },
    provenance: prov('ehr-a', 'MedicationRequest/rv-77', 1)
  }
]

export const PRIYA_MEDS: MedicationRequest[] = [
  {
    id: 'mr-ns-310',
    medication: 'Pembrolizumab 100 mg/4 mL',
    status: 'active',
    dosage_text: '200 mg IV every 3 weeks',
    effective_at: daysFromNow(-10),
    inventory: { status: 'backordered', on_hand: 0, expected_restock_at: daysFromNow(6) },
    provenance: prov('ehr-b', 'MedicationRequest/ns-310')
  },
  {
    id: 'mr-ns-311',
    medication: 'Pemetrexed 500 mg',
    status: 'active',
    dosage_text: '500 mg/m2 IV every 3 weeks',
    effective_at: daysFromNow(-10),
    inventory: { status: 'low', on_hand: 3, expected_restock_at: daysFromNow(2) },
    provenance: prov('ehr-b', 'MedicationRequest/ns-311')
  }
]

// ---- Notes. Riverside notes only appear after the transcript merge.
const note = (
  id: string,
  kind: string,
  title: string,
  author: string,
  daysAgo: number,
  source: string,
  body: string
): Note => ({
  id,
  kind,
  title,
  body,
  author_name: author,
  effective_at: daysFromNow(-daysAgo),
  is_legal_record: true,
  status: 'final',
  provenance: prov(source, `DocumentReference/${id}`)
})

export const GREGORY_NOTES_NORTHSIDE: Note[] = [
  note(
    'ns-n1',
    'referral',
    'Referral: lung mass',
    'Dr. Two',
    8,
    'ehr-b',
    'Referred for evaluation of a right upper lobe mass found on outside imaging. Plan: CT chest, CT-guided biopsy.'
  ),
  note(
    'ns-n2',
    'imaging_report',
    'CT chest with contrast',
    'Northside Radiology',
    7,
    'ehr-b',
    'Right upper lobe spiculated mass, 2.8 cm. No mediastinal adenopathy. Emphysematous changes.'
  )
]

export const GREGORY_NOTES_RIVERSIDE: Note[] = [
  note(
    'rv-n1',
    'progress',
    'COPD follow-up',
    'Dr. One',
    400,
    'ehr-a',
    'COPD, GOLD 2, stable on albuterol PRN. Former smoker, 40 pack-years, quit 2019. Allergy: penicillin (hives).'
  ),
  note(
    'rv-n2',
    'imaging_report',
    'Chest X-ray, 2 views',
    'Riverside Imaging',
    45,
    'ehr-a',
    'Hyperinflated lungs. Possible right upper lobe opacity; CT recommended.'
  )
]

export const LINDA_NOTES: Note[] = [
  note(
    'ns-n9',
    'progress',
    'Follow-up visit',
    'Dr. Maya Reyes',
    14,
    'ehr-b',
    'Hypertension and CKD stage 3 follow-up. Potassium 5.3 mmol/L; repeat BMP in 2 weeks.'
  )
]
