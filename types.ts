
export type HumanReviewStatus = 'unreviewed' | 'approved' | 'edited';
export type SegmentType = 'Speech' | 'Tune' | 'Song' | 'Silence' | 'Other';

export interface Provenance {
  generated_by: string;
  generated_at: string;
  generation_method: string;
  human_review_status: HumanReviewStatus;
  human_reviewer?: string;
}

export interface DescriptiveMetadata {
  // Dublin Core & General
  descriptor: string;
  contributor: string;
  coverage: string;
  creator: string;
  date: string;
  IE_format: string;
  description: string;
  identifier: string;
  language: string;
  publisher: string;
  relation: string;
  rights: string;
  source: string;
  subject: string;
  title: string;
  type: string;
  FullFolderOrFilePath: string;

  // ISAD(G) - Identity Area
  "isadg.identifier": string;
  "isadg.accessionNumber": string;
  "isadg.title": string;
  "isadg.levelOfDescription": string;
  "isadg.extentAndMedium": string;

  // ISAD(G) - Context Area
  "isadg.repository": string;
  "isadg.archivalHistory": string;
  "isadg.acquisition": string;

  // ISAD(G) - Content Area
  "isadg.scopeAndContent": string;
  "isadg.appraisal": string;
  "isadg.accruals": string;
  "isadg.arrangement": string;

  // ISAD(G) - Access Area
  "isadg.accessConditions": string;
  "isadg.reproductionConditions": string;
  "isadg.language": string;
  "isadg.script": string;
  "isadg.languageNote": string;

  // ISAD(G) - Allied Area
  "isadg.findingAids": string;
  "isadg.locationOfOriginals": string;
  "isadg.locationOfCopies": string;
  "isadg.relatedUnitsOfDescription": string;
  "isadg.publicationNote": string;

  // ISAD(G) - Notes Area
  "isadg.digitalObjectURI": string;
  "isadg.generalNote": string;

  // Access Points
  subjectAccessPoints: string;
  placeAccessPoints: string;
  nameAccessPoints: string;
  "isadg.genreAccessPoints": string;

  // ISAD(G) - Control Area
  "isadg.descriptionIdentifier": string;
  "isadg.institutionIdentifier": string;
  "isadg.descriptionStatus": string;
  "isadg.levelofDetail": string;
  "isadg.revisionHistory": string;
  "isadg.languageOfDescription": string;
  "isadg.scriptOfDescription": string;
  "isadg.sources": string;
  "isadg.archivistNote": string;
  "isadg.publicationStatus": string;

  // Physical Characteristics
  "isadg.physicalObjectName": string;
  "isadg.physicalObjectLocation": string;
  "isadg.physicalObjectType": string;
  "isadg.physicalCharacteristics": string;

  // Alternatives & Identifiers
  "isadg.alternativeIdentifier": string;
  "isadg.alternativeIdentifierLabels": string;
  "isadg.alternativeTitle": string;

  // Event Metadata
  eventDates: string;
  eventTypes: string;
  eventStartDates: string;
  eventEndDates: string;
  "isadg.eventActors": string;
  "isadg.eventActorHistories": string;
  "isadg.culture": string;

  // ATOM Fields
  "atom.legacyId": string;
  "atom.parentId": string;
  "atom.qubitParentSlug": string;

  // Digital Repository Specifics
  repository: string;
  "dc.coverage": string;
  "dc.language": string;
  "dc.subject": string;
  "dcterms.isPartOf": string;
  "dc.rights": string;
  "dc.format": string;
  "dc.contributor": string;
  "dc.description": string;
  "dc.creator": string;
  "dc.publisher": string;
  "dc.title": string;
  "dc.type": string;
  "dc.identifier": string;
  "dc.date": string;

  // Part Specifics
  parts: string;
  md5Checksum: string;
  technicalNotes: string;
  Notes: string;
  "isadg.rules": string;

  // App-specific internal fields (mapped to above for export)
  temporal_index: string;
  transcript: string;
}

export interface TechnicalMetadata {
  container_format: 'BWF' | 'WAV' | 'FLAC' | 'MP3';
  codec: string;
  sample_rate_hz: number;
  bit_depth: number;
  channels: number;
  duration_seconds: number;
  file_size_bytes: number;
  checksum: string;
  equipment?: string;
  software?: string;
  processing_notes: string[];
}

export interface AdministrativeMetadata {
  rights_holder: string;
  copyright_status: string;
  license: string;
  access_level: 'public' | 'research' | 'staff';
  restrictions: string;
  donor_agreement_ref?: string;
}

export interface StructuralSegment {
  id: string;
  start_time: number;
  end_time: number;
  type: SegmentType;
  summary: string;
  confidence: number;
  alternatives?: string[];
  notes?: string;
  provenance: Provenance;
  segment_metadata?: {
    tune_type?: string;
    meter?: string;
    tempo_bpm_range?: number[];
    instruments?: string[];
    region?: string;
    performers?: string[];
    evidence?: string[];
    notes?: string;
  };
}

export interface AudioSegment {
  id: string;
  startTime: number;
  endTime: number;
  label: string;
  category: 'music' | 'speech' | 'other';
  confidence: number;
  metadata: {
    description: string;
    performer?: string;
    tuneType?: string;
    meter?: string;
    tempo?: string;
    instruments?: string[];
    region?: string;
    context?: string;
    evidence?: string[];
    alternatives?: string[];
  };
}

export interface ArchivalAudioItem {
  descriptive: DescriptiveMetadata;
  technical: TechnicalMetadata;
  administrative: AdministrativeMetadata;
  structural: {
    segments: StructuralSegment[];
  };
}

export enum AnalysisState {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  COMPUTING_CHECKSUM = 'COMPUTING_CHECKSUM',
  TRANSCRIBING = 'TRANSCRIBING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}
