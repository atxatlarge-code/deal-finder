import React from 'react';
import { AlertCircle, Clock, Zap, Phone, Info, ShieldAlert, CheckCircle2 } from 'lucide-react';

// Helper to map technical types to Dallas Official Terms
const getOfficialLabel = (type: string, description: string) => {
  const upperType = type?.toUpperCase() || '';
  const desc = description?.toUpperCase() || '';
  
  if (upperType === 'EMERGENCY' || desc.includes('EMERGENCY')) return '🚨 Emergency Service Request';
  if (upperType === 'CODE_VIOLATION' || desc.includes('CCS')) return 'Code Compliance Case (CCS)';
  if (desc.includes('311')) return '311 Service Request';
  return 'Service Request (SR)';
};

export function ViolationTimeline({ signals }: { signals: any[] }) {
  if (!signals || signals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-400 text-sm font-medium">No official enforcement history found for this property.</p>
      </div>
    );
  }

  // Sort signals by date (Newest First)
  const sortedSignals = [...signals].sort((a, b) => 
    new Date(b.filed_at).getTime() - new Date(a.filed_at).getTime()
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      {/* HEADER */}
      <div className="bg-slate-50 border-b border-slate-200 p-4 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
          <ShieldAlert size={16} className="text-blue-600" /> 
          Official Enforcement Timeline
        </h3>
        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">
          DALLAS 311 / CCS DATA
        </span>
      </div>

      <div className="p-6 relative">
        {/* VERTICAL LINE */}
        <div className="absolute left-[31px] top-8 bottom-8 w-0.5 bg-slate-100" />

        <div className="space-y-8">
          {sortedSignals.map((s, idx) => {
            const isOpen = s.status?.toUpperCase() === 'OPEN';
            const isEmergency = s.signal_type === 'EMERGENCY' || s.raw_data?.priority === 'Emergency';
            const reporter = s.raw_data?.method_received_description || 'System';
            const deadline = s.raw_data?.ert_estimated_response_time;
            const officialLabel = getOfficialLabel(s.signal_type, s.description);

            return (
              <div key={s.id || idx} className="relative flex gap-4">
                {/* ICON NODE */}
                <div className={`z-10 flex items-center justify-center w-8 h-8 rounded-full border-4 border-white shadow-sm ${
                  isOpen ? 'bg-red-500 text-white' : 'bg-slate-400 text-white'
                }`}>
                  {isOpen ? <AlertCircle size={14} className="animate-pulse" /> : <CheckCircle2 size={14} />}
                </div>

                {/* CONTENT */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-tight font-mono">
                        {new Date(s.filed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      
                      {/* STATUS BADGE */}
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                        isOpen ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {s.status || 'CLOSED'}
                      </span>

                      {isEmergency && (
                        <span className="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          Priority 1
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-sm font-bold text-slate-900 leading-none">
                    {officialLabel}
                  </div>
                  
                  <div className="text-xs text-slate-600 mt-1.5 font-medium leading-relaxed">
                    {s.description || 'No description provided.'}
                  </div>

                  <div className="text-[11px] text-slate-400 mt-2 font-medium">
                    Case Ref: <span className="font-mono text-slate-500">{s.case_number || 'N/A'}</span>
                  </div>

                  {/* METADATA TAGS */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded">
                      {reporter === 'Phone' ? <Phone size={10} /> : <Zap size={10} />}
                      Intake: {reporter}
                    </span>
                    
                    {deadline && isOpen && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                        <Clock size={10} />
                        EST. RESPONSE: {deadline}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}