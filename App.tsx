
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArchivalAudioItem, AnalysisState, StructuralSegment, HumanReviewStatus, AudioSegment, SegmentType, DescriptiveMetadata } from './types';
import { transcribeAudio, suggestArchivalSegments, generateArchivalNarrative, decodeBase64, decodeAudioBuffer } from './services/geminiService';
import { computeSHA256 } from './services/checksum';
import { formatDuration } from './services/metadataProcessor';
import { ICONS } from './constants';
import Timeline from './components/Timeline';
import MetadataPanel from './components/MetadataPanel';

const ARCHIVAL_CSV_HEADERS = [
  "descriptor", "contributor", "coverage", "creator", "date", "IE_format", "description", "identifier", "language", "publisher", "relation", "rights", "source", "subject", "title", "type", "FullFolderOrFilePath", "isadg.identifier", "isadg.accessionNumber", "isadg.title", "isadg.levelOfDescription", "isadg.extentAndMedium", "isadg.repository", "isadg.archivalHistory", "isadg.acquisition", "isadg.scopeAndContent", "isadg.appraisal", "isadg.accruals", "isadg.arrangement", "isadg.accessConditions", "isadg.reproductionConditions", "isadg.language", "isadg.script", "isadg.languageNote", "isadg.findingAids", "isadg.locationOfOriginals", "isadg.locationOfCopies", "isadg.relatedUnitsOfDescription", "isadg.publicationNote", "isadg.digitalObjectURI", "isadg.generalNote", "subjectAccessPoints", "placeAccessPoints", "nameAccessPoints", "isadg.genreAccessPoints", "isadg.descriptionIdentifier", "isadg.institutionIdentifier", "isadg.descriptionStatus", "isadg.levelofDetail", "isadg.revisionHistory", "isadg.languageOfDescription", "isadg.scriptOfDescription", "isadg.sources", "isadg.archivistNote", "isadg.publicationStatus", "isadg.physicalObjectName", "isadg.physicalObjectLocation", "isadg.physicalObjectType", "isadg.alternativeIdentifier", "isadg.alternativeIdentifierLabels", "eventDates", "eventTypes", "eventStartDates", "eventEndDates", "isadg.eventActors", "isadg.eventActorHistories", "isadg.culture", "atom.legacyId", "atom.parentId", "atom.qubitParentSlug", "repository", "dc.coverage", "dc.language", "dc.subject", "dcterms.isPartOf", "dc.rights", "dc.format", "dc.contributor", "dc.description", "dc.creator", "dc.publisher", "dc.title", "dc.type", "dc.identifier", "dc.date", "parts", "md5Checksum", "technicalNotes", "Notes", "isadg.physicalCharacteristics", "isadg.rules", "isadg.alternativeTitle"
];

const App: React.FC = () => {
  const [state, setState] = useState<AnalysisState>(AnalysisState.IDLE);
  const [item, setItem] = useState<ArchivalAudioItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'tech' | 'admin' | 'struct'>('desc');
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsAudioCtx = useRef<AudioContext | null>(null);
  
  const resetApp = () => {
    setState(AnalysisState.IDLE);
    setItem(null);
    setError(null);
    setAudioUrl(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setSelectedSegmentId(null);
    setEditingSegmentId(null);
    setActiveTab('desc');
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
    }
  };

  const processBlob = async (blob: Blob, fileName: string) => {
    setState(AnalysisState.COMPUTING_CHECKSUM);
    setError(null);

    try {
      const file = new File([blob], fileName, { type: blob.type });
      const checksum = await computeSHA256(file);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const tempAudio = new Audio(url);
      await new Promise((resolve) => {
        tempAudio.onloadedmetadata = () => resolve(true);
      });
      const duration = tempAudio.duration;
      const mime = blob.type || (fileName.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');

      const initialDescriptive: Partial<DescriptiveMetadata> = {};
      ARCHIVAL_CSV_HEADERS.forEach(h => (initialDescriptive as any)[h] = "");
      
      const initialItem: ArchivalAudioItem = {
        descriptive: {
          ...initialDescriptive as DescriptiveMetadata,
          identifier: `ARCH_${new Date().getFullYear()}_${Math.floor(Math.random() * 10000)}`,
          title: fileName.split('.')[0] || 'Archival Record',
          description: 'Awaiting semantic abstract...',
          temporal_index: '',
          transcript: '',
          "isadg.levelOfDescription": "Item",
          "isadg.repository": "Irish Traditional Music Archive",
          "isadg.language": "en",
          "rights": "In copyright",
          "dc.rights": "In copyright"
        },
        technical: {
          container_format: (fileName.split('.').pop()?.toUpperCase() as any) || 'WAV',
          codec: 'PCM',
          sample_rate_hz: 48000,
          bit_depth: 24,
          channels: 2,
          duration_seconds: duration,
          file_size_bytes: blob.size,
          checksum: checksum,
          processing_notes: []
        },
        administrative: {
          rights_holder: 'Preservation Institution',
          copyright_status: 'Under Copyright',
          license: 'Internal Review',
          access_level: 'staff',
          restrictions: ''
        },
        structural: { segments: [] }
      };

      setItem(initialItem);
      
      setState(AnalysisState.TRANSCRIBING);
      const transcript = await transcribeAudio(blob);

      setItem(prev => prev ? ({
        ...prev,
        descriptive: { ...prev.descriptive, transcript: transcript, description: 'Phasing semantic audit...' }
      }) : null);

      setState(AnalysisState.ANALYZING);

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        try {
          const result = await suggestArchivalSegments(base64, mime, transcript, duration);
          setItem((prev: ArchivalAudioItem | null): ArchivalAudioItem | null => {
            if (!prev) return null;
            return {
              ...prev,
              descriptive: {
                ...prev.descriptive,
                temporal_index: result.temporal_index,
                description: result.description,
                "isadg.scopeAndContent": result.temporal_index, // Sync to ISADG Content Area
                "isadg.findingAids": result.temporal_index
              },
              structural: {
                segments: result.segments
              }
            };
          });
          setState(AnalysisState.COMPLETED);
        } catch (err: any) {
          setError(`Segmentation failed: ${err.message}`);
          setState(AnalysisState.ERROR);
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error(err);
      setError("Critical ingest error.");
      setState(AnalysisState.ERROR);
    }
  };

  const exportCSV = () => {
    if (!item) return;
    const metadata = item.descriptive;
    // Map current metadata values to exact CSV header order
    const row = ARCHIVAL_CSV_HEADERS.map(h => {
      let val = (metadata as any)[h] || "";
      // Handle special escapes
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');

    const csvContent = ARCHIVAL_CSV_HEADERS.join(',') + '\n' + row;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `METADATA_${item.descriptive.identifier}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const playNarrative = async () => {
    if (!item?.descriptive.description || isNarrating) return;
    setIsNarrating(true);
    try {
      const base64Audio = await generateArchivalNarrative(item.descriptive.description);
      if (!ttsAudioCtx.current) {
        ttsAudioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = ttsAudioCtx.current;
      const audioData = decodeBase64(base64Audio);
      const audioBuffer = await decodeAudioBuffer(audioData, ctx, 44100, 1);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsNarrating(false);
      source.start();
    } catch (err) {
      setIsNarrating(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processBlob(file, file.name);
  };

  const updateSegment = (segId: string, updates: Partial<StructuralSegment>) => {
    setItem((prev: ArchivalAudioItem | null): ArchivalAudioItem | null => {
      if (!prev) return null;
      return {
        ...prev,
        structural: {
          segments: prev.structural.segments.map((s): StructuralSegment => 
            s.id === segId ? { 
              ...s, 
              ...updates, 
              provenance: { 
                ...s.provenance, 
                human_review_status: 'edited' as HumanReviewStatus 
              } 
            } : s
          ).sort((a, b) => a.start_time - b.start_time)
        }
      };
    });
  };

  const onSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    audio.addEventListener('timeupdate', updateTime);
    return () => audio.removeEventListener('timeupdate', updateTime);
  }, [item?.technical.checksum]);

  const segments: AudioSegment[] = useMemo(() => 
    item?.structural.segments.map(s => ({
      id: s.id,
      startTime: s.start_time,
      endTime: s.end_time,
      label: s.type,
      category: (s.type === 'Tune' || s.type === 'Song' ? 'music' : s.type === 'Speech' ? 'speech' : 'other') as any,
      confidence: s.confidence,
      metadata: {
        description: s.summary,
        performer: s.segment_metadata?.performers?.[0],
        tuneType: s.segment_metadata?.tune_type,
        meter: s.segment_metadata?.meter,
        tempo: s.segment_metadata?.tempo_bpm_range ? `${s.segment_metadata.tempo_bpm_range[0]} BPM` : undefined,
        instruments: s.segment_metadata?.instruments,
        region: s.segment_metadata?.region,
        context: s.segment_metadata?.notes,
        evidence: s.segment_metadata?.evidence,
        alternatives: s.alternatives
      }
    })) || [], [item?.structural.segments]);

  const selectedSegment = segments.find(s => s.id === selectedSegmentId) || null;

  const updateDesc = (key: keyof DescriptiveMetadata, val: string) => {
    if (!item) return;
    setItem({
      ...item,
      descriptive: { ...item.descriptive, [key]: val }
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200">
      <header className="border-b border-white/10 bg-slate-900/80 backdrop-blur-2xl px-8 h-20 flex items-center justify-between sticky top-0 z-50 shadow-2xl">
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center cursor-pointer hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/30 group" onClick={resetApp}>
            <ICONS.Reel className="text-white w-7 h-7 group-hover:scale-110 transition-transform" />
          </div>
          <div className="cursor-pointer group" onClick={resetApp}>
            <h1 className="font-black text-2xl tracking-tighter text-white group-hover:text-indigo-400 transition-colors">EchoArchive</h1>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {item && state === AnalysisState.COMPLETED && (
            <button onClick={exportCSV} className="flex items-center gap-3 text-[11px] font-black tracking-widest text-white transition-all uppercase px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 shadow-xl shadow-emerald-900/20">
              <ICONS.Download className="w-4 h-4" />
              EXPORT CSV (TEMPLATE)
            </button>
          )}
          {state !== AnalysisState.IDLE && (
            <button onClick={resetApp} className="flex items-center gap-3 text-[11px] font-black tracking-widest text-slate-400 hover:text-white transition-all uppercase px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 active:scale-95">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              RESET ENGINE
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {state === AnalysisState.IDLE ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950">
            {/* PROBLEM & SOLUTION VIEW */}
            <section className="max-w-7xl mx-auto pt-32 pb-24 px-8 grid grid-cols-1 md:grid-cols-2 gap-12">
               {/* Problem Card */}
               <div className="space-y-12 bg-slate-900/60 p-16 rounded-[4rem] border border-white/5 shadow-2xl animate-in slide-in-from-left duration-1000">
                  <h3 className="text-5xl font-black italic tracking-tighter flex items-center gap-6 text-white uppercase">
                    <span className="text-red-500/80 not-italic">01.</span> The Problem
                  </h3>
                  <div className="space-y-10">
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-slate-950 flex items-center justify-center shrink-0 border border-white/10 text-slate-600 font-black text-xl shadow-inner">!</div>
                       <p className="text-xl text-slate-400 font-bold leading-relaxed">
                         Archives hold vast collections of long, complex audio, but cataloguing is slow, manual, and expensive.
                       </p>
                    </div>
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-slate-950 flex items-center justify-center shrink-0 border border-white/10 text-slate-600 font-black text-xl shadow-inner">?</div>
                       <p className="text-xl text-slate-400 font-bold leading-relaxed">
                         Staff must listen to every second to identify musical tunes, speech, or performers.
                       </p>
                    </div>
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-slate-950 flex items-center justify-center shrink-0 border border-white/10 text-slate-600 font-black text-xl shadow-inner">#</div>
                       <p className="text-xl text-slate-400 font-bold leading-relaxed">
                         Recordings remain invisible to researchers without time-coded structural finding aids.
                       </p>
                    </div>
                  </div>
               </div>

               {/* Solution Card */}
               <div className="space-y-12 bg-indigo-950/20 p-16 rounded-[4rem] border border-indigo-500/20 shadow-2xl relative overflow-hidden animate-in slide-in-from-right duration-1000">
                  <div className="absolute top-0 right-0 p-10 opacity-5">
                     <ICONS.Reel className="w-56 h-56" />
                  </div>
                  <h3 className="text-5xl font-black italic tracking-tighter flex items-center gap-6 text-white uppercase">
                    <span className="text-indigo-500 not-italic">02.</span> The Solution
                  </h3>
                  <div className="space-y-10 relative z-10">
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30 text-indigo-400 font-black text-xl shadow-xl">✓</div>
                       <p className="text-xl text-indigo-200/80 font-bold leading-relaxed">
                         A Semantic Indexing layer designed for archival preservation workflows.
                       </p>
                    </div>
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30 text-indigo-400 font-black text-xl shadow-xl">✓</div>
                       <p className="text-xl text-indigo-200/80 font-bold leading-relaxed">
                         Automatically segments bitstreams and generates ethnomusicological metadata in seconds.
                       </p>
                    </div>
                    <div className="flex gap-8 items-start">
                       <div className="w-12 h-12 rounded-3xl bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30 text-indigo-400 font-black text-xl shadow-xl">✓</div>
                       <p className="text-xl text-indigo-200/80 font-bold leading-relaxed">
                         Reduces manual audit time by up to 90%, allowing for scale in collection access.
                       </p>
                    </div>
                  </div>
               </div>
            </section>

            {/* MAIN HERO / CTA */}
            <section className="relative flex flex-col items-center justify-center py-20 px-8 text-center">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(79,70,229,0.08),transparent_70%)]"></div>
                <div className="max-w-4xl space-y-16 relative z-10">
                  <h2 className="text-[12rem] font-black tracking-tighter leading-[0.75] text-white select-none">
                    Structure <br/><span className="text-indigo-500 italic">For</span> <br/>Sound.
                  </h2>
                  <div className="flex flex-col items-center gap-12">
                    <p className="text-3xl text-slate-400 font-medium max-w-2xl leading-relaxed italic">
                      Automate discovery for traditional music archives using deep semantic listening.
                    </p>
                    <div className="pt-6">
                      <label className="bg-white text-black px-24 py-12 rounded-full text-[2.5rem] font-black cursor-pointer shadow-[0_20px_100px_rgba(255,255,255,0.1)] hover:scale-[1.02] active:scale-95 transition-all text-center inline-block">
                        <span className="tracking-tight">BEGIN ARCHIVAL INGEST</span>
                        <input type="file" className="hidden" onChange={handleFileUpload} />
                      </label>
                      <p className="mt-12 text-slate-600 font-black text-[12px] uppercase tracking-[0.6em] animate-pulse">Phasing Acoustic Neural Layer v2.1</p>
                    </div>
                  </div>
                </div>
            </section>

            {/* OUR STORY SECTION */}
            <section className="max-w-6xl mx-auto py-40 px-8">
                <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 p-24 rounded-[7rem] shadow-[0_0_180px_rgba(79,70,229,0.25)] border-4 border-indigo-400/20 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-16 opacity-10">
                    <ICONS.Archive className="w-64 h-64" />
                  </div>
                  <h3 className="text-[16px] font-black uppercase tracking-[0.8em] text-indigo-400 mb-12 italic relative z-10">Our Story</h3>
                  <div className="space-y-10 relative z-10">
                    <div className="space-y-6 text-xl text-indigo-100/70 font-medium leading-relaxed max-w-4xl">
                      <p className="text-white font-black text-4xl leading-tight italic tracking-tighter mb-10">
                        Soundarc's mission is to Preserve Ireland’s sonic heritage
                      </p>
                      <p>
                        Soundarc was founded by Brendan Donnelly, in collaboration with digital audio archivist Liam O’Brien. Brendan, a startup founder and Oxford graduate, became interested in how AI could help protect fragile recordings of Irish traditional music at risk. Much of Ireland’s cultural memory—Irish-language oral histories, tunes, and regional styles—remains scattered, slow to digitise, and difficult to search.
                      </p>
                      <p>
                        He partnered with Liam, a digital audio archivist with experience at ITMA, RTÉ, and TG4, to create Soundarc.
                      </p>
                      <p>
                        Soundarc is a Semantic Audio Indexing layer for archives, automatically structuring long recordings into time-coded, searchable segments—by tune type, instrument, region, performer, and context.
                      </p>
                      <p>
                        The team also includes Sean O’Brien, who leads collaborations and partnerships.
                      </p>
                      <p className="text-white font-bold text-2xl pt-6 italic border-t border-white/10">
                        The result: faster digitisation, searchable archives, and cultural memory preserved before it disappears.
                      </p>
                    </div>
                  </div>
                </div>
            </section>
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col overflow-hidden border-r border-white/10 bg-slate-950">
                {state !== AnalysisState.COMPLETED && state !== AnalysisState.ERROR ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-950/40 backdrop-blur-3xl animate-in fade-in duration-500">
                     <div className="relative w-64 h-64 mb-20">
                        <div className="absolute inset-0 border-[12px] border-indigo-500/10 rounded-full scale-125"></div>
                        <div className="absolute inset-0 border-[12px] border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <div className="absolute inset-12 bg-indigo-500/5 rounded-full flex items-center justify-center border-2 border-indigo-500/20 shadow-inner">
                            <ICONS.Mic className="w-24 h-24 text-indigo-400 animate-pulse" />
                        </div>
                     </div>
                     <h2 className="text-6xl font-black mb-8 tracking-tighter text-white uppercase italic">
                       {state === AnalysisState.COMPUTING_CHECKSUM ? 'Verifying Integrity...' : 
                        state === AnalysisState.TRANSCRIBING ? 'Transcribing bitstream...' : 
                        state === AnalysisState.ANALYZING ? 'Phasing Semantic Segments...' : 'Processing...'}
                     </h2>
                     <p className="text-slate-500 uppercase tracking-[0.5em] font-black text-sm">ARCHIVAL_INDEX_IN_PROGRESS</p>
                  </div>
                ) : error ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-20 text-center">
                      <div className="w-24 h-24 bg-red-500/10 border-2 border-red-500/20 rounded-3xl flex items-center justify-center mb-10">
                        <span className="text-red-500 text-4xl font-black">!</span>
                      </div>
                      <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter mb-6">Processing Halted</h2>
                      <p className="text-slate-400 text-xl font-bold mb-12 max-w-md">{error}</p>
                      <button onClick={resetApp} className="bg-white text-black px-12 py-5 rounded-2xl font-black uppercase text-sm hover:scale-105 transition-all">Retry Ingest</button>
                  </div>
                ) : (
                  <>
                    <div className="p-10 bg-slate-900/50 border-b border-white/10">
                        <Timeline segments={segments} duration={item?.technical.duration_seconds || 1} currentTime={currentTime} onSeek={onSeek} selectedSegmentId={selectedSegmentId} onSelectSegment={setSelectedSegmentId} audioUrl={audioUrl} />
                    </div>

                    <div className="flex px-8 border-b border-white/10 bg-slate-900/30 items-center justify-between">
                        <div className="flex">
                          {[ 
                            { id: 'desc', label: 'Descriptive' }, 
                            { id: 'tech', label: 'Technical' }, 
                            { id: 'admin', label: 'Admin' }, 
                            { id: 'struct', label: 'Structural Audit' }
                          ].map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-10 py-6 text-[11px] uppercase font-black tracking-[0.3em] transition-all relative ${activeTab === tab.id ? 'text-indigo-400 bg-indigo-500/[0.05]' : 'text-slate-500 hover:text-slate-300'}`}>
                              {tab.label}
                              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-indigo-500 shadow-[0_-4px_20px_rgba(99,102,241,0.8)]"></div>}
                            </button>
                          ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-12 custom-scrollbar bg-slate-950">
                      {item && (
                        <div className="max-w-6xl mx-auto space-y-20 pb-40 animate-in fade-in duration-700">
                          {activeTab === 'desc' && (
                            <section className="space-y-20">
                               {/* IDENTITY AREA */}
                               <div className="bg-slate-900/40 border-2 border-white/5 p-12 rounded-[4rem] space-y-12 shadow-2xl">
                                  <h4 className="text-[12px] font-black uppercase text-indigo-400 tracking-[0.6em] italic mb-10 pb-4 border-b border-indigo-500/10">ISAD(G) - Identity Area</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                                     <div className="md:col-span-2">
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Archival Title</label>
                                        <input value={item.descriptive.title} onChange={(e) => updateDesc('title', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-8 rounded-[2rem] text-3xl focus:border-indigo-500/50 outline-none transition-all font-black text-white" />
                                     </div>
                                     <div>
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Reference Code / ID</label>
                                        <input value={item.descriptive.identifier} onChange={(e) => updateDesc('identifier', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-8 rounded-[2rem] text-xl focus:border-indigo-500/50 outline-none transition-all font-mono text-indigo-400" />
                                     </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
                                     <div>
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Accession No.</label>
                                        <input value={item.descriptive["isadg.accessionNumber"]} onChange={(e) => updateDesc('isadg.accessionNumber', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                     </div>
                                     <div>
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Level of Description</label>
                                        <select value={item.descriptive["isadg.levelOfDescription"]} onChange={(e) => updateDesc('isadg.levelOfDescription', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300">
                                           <option>Item</option>
                                           <option>File</option>
                                           <option>Series</option>
                                           <option>Fonds</option>
                                        </select>
                                     </div>
                                     <div>
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Extent & Medium</label>
                                        <input value={item.descriptive["isadg.extentAndMedium"]} onChange={(e) => updateDesc('isadg.extentAndMedium', e.target.value)} placeholder="e.g. 1 sound cassette" className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                     </div>
                                     <div>
                                        <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Dates</label>
                                        <input value={item.descriptive.date} onChange={(e) => updateDesc('date', e.target.value)} placeholder="YYYY-MM-DD" className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                     </div>
                                  </div>
                               </div>

                               {/* CONTEXT & CONTENT AREAS */}
                               <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 pt-10">
                                  <div className="bg-slate-900/40 border-2 border-white/5 p-12 rounded-[4rem] space-y-10 shadow-2xl">
                                     <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-[0.6em] italic mb-6">ISAD(G) - Context Area</h4>
                                     <div className="space-y-8">
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Creator (DC.Creator)</label>
                                          <input value={item.descriptive.creator} onChange={(e) => updateDesc('creator', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Repository</label>
                                          <input value={item.descriptive["isadg.repository"]} onChange={(e) => updateDesc('isadg.repository', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Archival History</label>
                                          <textarea rows={4} value={item.descriptive["isadg.archivalHistory"]} onChange={(e) => updateDesc('isadg.archivalHistory', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-400 font-medium italic" />
                                        </div>
                                     </div>
                                  </div>

                                  <div className="bg-slate-900/40 border-2 border-white/5 p-12 rounded-[4rem] space-y-10 shadow-2xl">
                                     <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-[0.6em] italic mb-6">ISAD(G) - Content & Arrangement Area</h4>
                                     <div className="space-y-8">
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Arrangement Area</label>
                                          <textarea rows={4} value={item.descriptive["isadg.arrangement"]} onChange={(e) => updateDesc('isadg.arrangement', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-400 font-medium italic" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Appraisal / Accruals</label>
                                          <input value={item.descriptive["isadg.appraisal"]} onChange={(e) => updateDesc('isadg.appraisal', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                     </div>
                                  </div>
                               </div>

                               {/* FINDING AID & SCOPE (Chronometric Finding Aid) */}
                               <div className="space-y-12">
                                  <div className="flex items-center justify-between mb-4">
                                      <div className="flex items-center gap-3">
                                          <div className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] animate-pulse"></div>
                                          <h3 className="text-[13px] uppercase font-black text-indigo-400 tracking-[0.5em] leading-none italic">Chronometric Finding Aid / Scope & Content</h3>
                                      </div>
                                      <button onClick={playNarrative} disabled={isNarrating} className={`text-[10px] font-black flex items-center gap-4 px-6 py-3 rounded-full border uppercase tracking-widest transition-all ${isNarrating ? 'bg-indigo-500/40 border-indigo-500/50 text-white animate-pulse' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 active:scale-95 shadow-2xl'}`}>
                                          {isNarrating ? 'NARRATING...' : 'SYNTHESIZE SPEECH'}
                                      </button>
                                  </div>
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                                      <div className="relative group">
                                         <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-transparent rounded-[3.5rem] blur opacity-50"></div>
                                         <textarea rows={20} value={item.descriptive["isadg.scopeAndContent"]} onChange={(e) => updateDesc('isadg.scopeAndContent', e.target.value)} className="relative w-full bg-slate-900 border-2 border-white/5 p-10 rounded-[3.5rem] text-[13px] leading-relaxed focus:border-indigo-500/50 outline-none font-mono text-slate-300 resize-none shadow-2xl custom-scrollbar" placeholder="Generating sequence index..." />
                                      </div>
                                      <div className="relative group">
                                         <div className="absolute -inset-1 bg-gradient-to-l from-indigo-500/10 to-transparent rounded-[4.5rem] blur opacity-30"></div>
                                         <textarea rows={20} value={item.descriptive.description} onChange={(e) => updateDesc('description', e.target.value)} className="relative w-full bg-slate-950 border-2 border-white/5 p-12 rounded-[4.5rem] text-xl leading-relaxed focus:border-indigo-500/50 outline-none transition-all font-medium shadow-2xl italic text-slate-200" placeholder="Generating semantic abstract..." />
                                      </div>
                                  </div>
                               </div>

                               {/* ACCESS & CONTROL AREA */}
                               <div className="bg-slate-900/40 border-2 border-white/5 p-12 rounded-[4rem] space-y-12 shadow-2xl">
                                  <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-[0.6em] italic mb-10 pb-4 border-b border-indigo-500/10">Access Points & Rights</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                                     <div className="space-y-8">
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Subject Access Points</label>
                                          <input value={item.descriptive.subjectAccessPoints} onChange={(e) => updateDesc('subjectAccessPoints', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Place Access Points</label>
                                          <input value={item.descriptive.placeAccessPoints} onChange={(e) => updateDesc('placeAccessPoints', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                     </div>
                                     <div className="space-y-8">
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Name Access Points</label>
                                          <input value={item.descriptive.nameAccessPoints} onChange={(e) => updateDesc('nameAccessPoints', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Genre Access Points</label>
                                          <input value={item.descriptive["isadg.genreAccessPoints"]} onChange={(e) => updateDesc('isadg.genreAccessPoints', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300" />
                                        </div>
                                     </div>
                                     <div className="space-y-8">
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Rights (DC.Rights)</label>
                                          <input value={item.descriptive.rights} onChange={(e) => updateDesc('rights', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300 font-bold" />
                                        </div>
                                        <div>
                                          <label className="text-[11px] uppercase font-black text-slate-600 block mb-4 tracking-[0.4em]">Access Conditions</label>
                                          <input value={item.descriptive["isadg.accessConditions"]} onChange={(e) => updateDesc('isadg.accessConditions', e.target.value)} className="w-full bg-slate-950 border border-white/10 p-6 rounded-2xl text-sm focus:border-indigo-500/50 outline-none transition-all text-slate-300 font-bold" />
                                        </div>
                                     </div>
                                  </div>
                               </div>

                               {item.descriptive.transcript && (
                                 <div className="mt-20 border-t border-white/10 pt-24">
                                    <div className="flex items-center gap-4 mb-10">
                                      <span className="bg-indigo-500 text-white text-[10px] font-black px-6 py-2 rounded-full uppercase tracking-widest shadow-xl">Transcription Layer</span>
                                      <p className="text-slate-600 font-black text-[10px] uppercase tracking-widest italic">Validated through Phasing Acoustic Neural Layer</p>
                                    </div>
                                    <div className="bg-slate-900/40 p-20 rounded-[6rem] text-slate-400 leading-relaxed font-serif text-2xl italic shadow-inner border border-white/5 group">
                                      <div className="opacity-70 group-hover:opacity-100 transition-opacity duration-700">
                                        {item.descriptive.transcript}
                                      </div>
                                    </div>
                                 </div>
                               )}
                            </section>
                          )}

                          {activeTab === 'struct' && (
                            <section className="space-y-12 pb-40">
                               {item.structural.segments.map((seg) => (
                                    <div key={seg.id} className={`bg-slate-900/40 border-2 rounded-[4rem] overflow-hidden transition-all duration-700 group/item ${selectedSegmentId === seg.id ? 'border-indigo-500/80 bg-indigo-500/10 shadow-2xl scale-[1.02]' : 'border-white/5 hover:bg-white/5'}`} onClick={() => setSelectedSegmentId(seg.id)}>
                                      <div className="p-12 flex gap-12">
                                         <div className="w-40 flex-shrink-0 font-mono text-[16px] text-slate-500 pt-2 flex flex-col items-center gap-6">
                                           <button className="hover:text-indigo-400 transition-colors py-3 px-5 rounded-2xl hover:bg-white/10 font-black tabular-nums border border-white/5" onClick={(e) => { e.stopPropagation(); onSeek(seg.start_time); }}>{formatDuration(seg.start_time).split('.')[0].substring(3)}</button>
                                           <div className="w-px h-12 bg-slate-800 opacity-40"></div>
                                           <button className="hover:text-indigo-400 transition-colors py-3 px-5 rounded-2xl hover:bg-white/10 font-black tabular-nums border border-white/5" onClick={(e) => { e.stopPropagation(); onSeek(seg.end_time); }}>{formatDuration(seg.end_time).split('.')[0].substring(3)}</button>
                                         </div>
                                         <div className="flex-1 space-y-8">
                                            {editingSegmentId === seg.id ? (
                                              <div className="space-y-10 p-10 bg-black/40 rounded-[3.5rem] border border-white/10 shadow-inner">
                                                 <div className="grid grid-cols-3 gap-10">
                                                   <div>
                                                     <label className="text-[11px] uppercase font-black text-slate-500 tracking-widest mb-4 block">Class</label>
                                                     <select value={seg.type} onChange={(e) => updateSegment(seg.id, { type: e.target.value as SegmentType })} className="w-full bg-slate-950 border border-white/20 rounded-2xl px-6 py-5 text-sm font-black text-slate-200 outline-none focus:border-indigo-500 shadow-xl">
                                                       <option>Speech</option><option>Tune</option><option>Song</option><option>Silence</option><option>Other</option>
                                                     </select>
                                                   </div>
                                                   <div><label className="text-[11px] uppercase font-black text-slate-500 tracking-widest mb-4 block">In (s)</label><input type="number" step="0.01" value={seg.start_time} onChange={(e) => updateSegment(seg.id, { start_time: parseFloat(e.target.value) })} className="w-full bg-slate-950 border border-white/20 rounded-2xl px-6 py-5 text-sm font-mono text-indigo-400 outline-none focus:border-indigo-500" /></div>
                                                   <div><label className="text-[11px] uppercase font-black text-slate-500 tracking-widest mb-4 block">Out (s)</label><input type="number" step="0.01" value={seg.end_time} onChange={(e) => updateSegment(seg.id, { end_time: parseFloat(e.target.value) })} className="w-full bg-slate-950 border border-white/20 rounded-2xl px-6 py-5 text-sm font-mono text-indigo-400 outline-none focus:border-indigo-500" /></div>
                                                 </div>
                                                 <div className="flex justify-end pt-4"><button onClick={() => setEditingSegmentId(null)} className="bg-indigo-600 text-white px-12 py-5 rounded-[2rem] text-[13px] font-black tracking-widest uppercase hover:bg-indigo-500 shadow-2xl active:scale-95">COMMIT AUDIT</button></div>
                                              </div>
                                            ) : (
                                              <>
                                                <div className="flex justify-between items-start">
                                                   <div className="flex items-center gap-8">
                                                      <h4 className="font-black text-2xl uppercase tracking-[0.2em] text-white italic">{seg.type}</h4>
                                                      <span className="text-slate-600 text-[10px] font-black tracking-widest uppercase bg-white/5 px-4 py-1.5 rounded-full border border-white/5">Confidence: {Math.round(seg.confidence * 100)}%</span>
                                                   </div>
                                                   <div className="flex gap-10 opacity-0 group-hover/item:opacity-100 transition-all"><button onClick={(e) => { e.stopPropagation(); setEditingSegmentId(seg.id); }} className="text-[11px] font-black text-slate-500 hover:text-white uppercase tracking-widest border-b border-white/10 pb-1">ADJUST_TIMELINE</button></div>
                                                </div>
                                                <p className="text-2xl text-slate-300 leading-relaxed font-bold italic">"{seg.summary}"</p>
                                              </>
                                            )}
                                         </div>
                                      </div>
                                    </div>
                                  ))}
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
            </div>

            <aside className="w-[500px] flex flex-col bg-slate-950 border-l border-white/10 shadow-[-40px_0_80px_rgba(0,0,0,0.5)] z-40">
               <div className="p-12 border-b border-white/10 bg-slate-900/40">
                  <h3 className="text-[13px] font-black uppercase text-slate-500 mb-12 tracking-[0.5em] flex justify-between items-center italic">BITSTREAM_NAV</h3>
                  <div className="bg-slate-900/90 p-16 rounded-[5rem] flex flex-col items-center justify-center gap-14 shadow-2xl border-2 border-white/10 relative overflow-hidden group/player">
                      <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-none"></div>
                      <div className="flex items-center gap-12 relative z-10">
                        <button onClick={togglePlayback} className="w-40 h-40 bg-white rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-90 transition-all shadow-[0_0_100px_rgba(255,255,255,0.2)] border-[10px] border-indigo-500/10">{isPlaying ? <ICONS.Pause className="w-20 h-20" /> : <ICONS.Play className="w-20 h-20 ml-4" />}</button>
                      </div>
                      <div className="text-center relative z-10"><p className="font-mono text-7xl font-black text-white leading-none tabular-nums tracking-tighter">{formatDuration(currentTime).split('.')[0]}</p></div>
                  </div>
               </div>
               <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/50"><MetadataPanel segment={selectedSegment} /></div>
            </aside>
          </>
        )}
      </main>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} className="hidden" onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
      )}
    </div>
  );
};

export default App;
