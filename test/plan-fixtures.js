export const label=n=>'S'+String(n).padStart(2,'0');
export const feature=n=>'F'+String(n).padStart(2,'0');
export const section=(n,{deps='none',children=false,featureId}={})=>`## ${label(n)} — ${['Foundation','Composition','Consumer','Export'][n-1]??'Unit'}\n- Implementer: impl_large\n- Depends on: ${deps}\n${featureId?`- Feature: ${featureId}\n`:''}${children?['A','B'].map((child,index)=>`### ${label(n)}.${child} — ${['Representation','Composition'][index]}\n- Implementer: impl_large\n- Depends on: ${index?label(n)+'.A':'none'}\n`).join(''):''}`;
export const plan=(count=1)=>'# Plan\n\n'+Array.from({length:count},(_,index)=>section(index+1)).join('\n');
