export function summarizeFrameIntervals(intervals, minimum=120) {
  if(!Array.isArray(intervals)||intervals.length<minimum||intervals.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Incomplete or invalid frame samples');
  const sorted=[...intervals].sort((a,b)=>a-b);
  const total=intervals.reduce((a,b)=>a+b,0);
  return {samples:intervals.length,fps:1000*intervals.length/total,meanMs:total/intervals.length,
    medianMs:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],
    p99Ms:sorted[Math.ceil(sorted.length*.99)-1],maxMs:sorted.at(-1),over50Ms:intervals.filter(v=>v>50).length};
}
