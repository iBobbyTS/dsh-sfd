#!/usr/bin/env python3
"""Read-only structural PLAN helper; never an approval, actor, or scheduling gate.

Format: ## S01 — title; optional ### S01.A — title.
Every unit has one logical Implementer: impl_std or impl_large and Depends on: field.
No JSON schedule, required hashes, receipt schemas, Git lookup, or workflow state.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass, field, asdict
import json
from pathlib import Path
import re
import sys

PROFILES = {'impl_std','impl_large'}
UNIT_ID = r'S\d{2,}(?:[.\-][A-Z0-9]+)?'
FEATURE_ID = r'F\d{2,}'
FEATURE_HEADER = re.compile(r'^###\s+Feature\s+(' + FEATURE_ID + r')\s*(?:[—–:\-]\s*|\s+)(\S.*)$')
HEADER = re.compile(r'^(#{2,3})\s+(' + UNIT_ID + r')\s*(?:[—–:\-]\s*|\s+)(\S.*)$')
FIELD = re.compile(r'^\s*(?:[-*]\s*)?(Implementer|Profile|实现者|实现代理|Depends on|Dependencies|依赖|Feature|所属 Feature)\s*[:：]\s*(.*?)\s*$', re.I)
NONE = {'none','无','—','-','[]','无依赖'}

@dataclass
class Unit:
    id: str
    title: str
    parent: str | None
    start: int
    end: int
    profile: str | None = None
    depends_on: list[str] = field(default_factory=list)
    field_counts: dict[str,int] = field(default_factory=dict)
    feature_id: str | None = None

@dataclass
class Feature:
    id: str
    title: str
    start: int
    end: int

@dataclass
class Plan:
    text: str
    units: list[Unit]
    errors: list[str]
    warnings: list[str]
    features: list[Feature] = field(default_factory=list)


def parse(text: str) -> Plan:
    lines = text.splitlines(keepends=True)
    units: list[Unit] = []
    features: list[Feature] = []
    current_feature: Feature | None = None
    errors: list[str] = []
    warnings: list[str] = []
    active: Unit | None = None
    parent: str | None = None
    fence: str | None = None
    for index,line in enumerate(lines):
        stripped=line.strip()
        fm=re.match(r'^(`{3,}|~{3,})',stripped)
        if fm:
            mark=fm.group(1)
            if fence is None: fence=mark
            elif mark[0]==fence[0] and len(mark)>=len(fence): fence=None
            continue
        if fence is not None: continue
        if current_feature is not None and re.match(r'^#{1,3}\s+', line):
            current_feature.end=index
            current_feature=None
        if re.match(r'^###\s+Feature\b', line):
            fm_feature=FEATURE_HEADER.match(line.rstrip())
            if not fm_feature:
                errors.append(f'line {index+1}: malformed Feature heading (expected ### Feature F01 — title)')
            elif units:
                errors.append(f'line {index+1}: Feature contract must precede all executable sections')
            else:
                fid,title=fm_feature.groups()
                current_feature=Feature(fid,title,index,len(lines))
                features.append(current_feature)
            continue
        hm=HEADER.match(line.rstrip())
        if hm:
            level,uid,title=hm.groups()
            is_child=bool(re.search(r'[.\-]',uid))
            if (level=='##' and is_child) or (level=='###' and not is_child):
                errors.append(f'line {index+1}: use ## for parents and ### for children: {uid}')
            if active: active.end=index
            if not is_child: parent=uid
            declared_parent=re.split(r'[.\-]',uid)[0] if is_child else None
            if is_child and declared_parent!=parent:
                errors.append(f'line {index+1}: {uid} must be nested below {declared_parent}')
            active=Unit(uid,title,declared_parent,index,len(lines));units.append(active)
            continue
        # Unrelated ## ends the executable-unit area (e.g. final integration).
        if re.match(r'^##\s+',line):
            if active: active.end=index
            active=None;parent=None
            continue
        if active:
            match=FIELD.match(line.rstrip())
            if not match: continue
            label,value=match.groups()
            kind=('profile' if label.lower() in {'implementer','profile','实现者','实现代理'}
                  else 'feature' if label.lower() in {'feature','所属 feature'} else 'deps')
            active.field_counts[kind]=active.field_counts.get(kind,0)+1
            if active.field_counts[kind]>1:
                errors.append(f'{active.id}: duplicate {kind} field')
            if kind=='profile':
                profile=value.strip().strip('`')
                if profile not in PROFILES:
                    errors.append(f'{active.id}: explicit logical tier impl_std or impl_large required; transport belongs to dispatch profile')
                else: active.profile=profile
            elif kind=='feature':
                if active.parent is not None:
                    errors.append(f'{active.id}: subsection inherits its Feature; do not assign another')
                else:
                    active.feature_id=value.strip().strip('`')
                    if not active.feature_id: errors.append(f'{active.id}: empty Feature binding')
            else:
                clean=value.strip().strip('`')
                if clean.lower() in NONE: active.depends_on=[]
                else:
                    deps=[x.strip().strip('`') for x in re.split(r'[,，、]',clean)]
                    if any(not re.fullmatch(UNIT_ID,x) for x in deps):
                        errors.append(f'{active.id}: dependencies must be comma-separated IDs or none')
                    else: active.depends_on=deps
    if not units: errors.append('no business sections: use ## S01 — title')
    ids: dict[str,Unit]={}
    for u in units:
        if u.id in ids: errors.append(f'duplicate unit ID: {u.id}')
        ids[u.id]=u
        if u.profile is None and not u.field_counts.get('profile'): errors.append(f'{u.id}: missing Implementer')
        if not u.field_counts.get('deps'): errors.append(f'{u.id}: missing Depends on (use none for no dependency)')
    for u in units:
        if u.parent and (u.parent not in ids or ids[u.parent].parent is not None):
            errors.append(f'{u.id}: missing business parent {u.parent}')
        if len(u.depends_on)!=len(set(u.depends_on)): errors.append(f'{u.id}: repeated dependency')
        for dep in u.depends_on:
            if dep not in ids: errors.append(f'{u.id}: unknown dependency {dep}')
            elif u.parent is None and ids[dep].parent is not None:
                errors.append(f'{u.id}: external consumers depend on accepted parent, not child {dep}')
            elif u.parent and ids[dep].parent!=u.parent:
                errors.append(f'{u.id}: child dependencies are siblings only; put external dependencies on {u.parent}')
    visiting:set[str]=set();done:set[str]=set()
    def visit(uid:str,path:list[str]) -> None:
        if uid in visiting:
            errors.append('dependency cycle: '+' -> '.join(path+[uid]));return
        if uid in done:return
        visiting.add(uid)
        for dep in ids[uid].depends_on:
            if dep in ids:visit(dep,path+[uid])
        visiting.remove(uid);done.add(uid)
    for uid in ids:visit(uid,[])
    # Legacy implicit one-Feature plans retain their existing fields and behavior.
    if features:
        known_features={f.id for f in features}
        if len(known_features)!=len(features): errors.append('duplicate Feature contract ID')
        for u in units:
            if u.parent is None:
                if u.feature_id is None: errors.append(f'{u.id}: missing Feature binding in explicit Feature plan')
                elif u.feature_id not in known_features: errors.append(f'{u.id}: unknown Feature binding {u.feature_id}')
            elif u.parent in ids: u.feature_id=ids[u.parent].feature_id
    for u in units:
        if u.parent is None and sum(c.parent==u.id for c in units)==1:
            warnings.append(f'{u.id}: a single child usually belongs in parent work steps, not a subsection')
    if 'SFD_PLAN_V4' in text:
        warnings.append('legacy machine block is not used; do not maintain it as a second plan authority')
    return Plan(text,units,errors,warnings,features)


# Only recognized routing metadata is omitted for legacy plans. Unknown fields and
# permission/oracle prose remain authoritative; new templates mark whole Main-only
# blocks explicitly rather than asking an extractor to infer their meaning.
MAIN_FIELDS = re.compile(
    r'^\s*(?:[-*]\s*)?(?:Implementer|Profile|实现者|实现代理|'
    r'Installation target / home|Dispatch profile|'
    r'Reviewer routes \(A/B, actual native/external transport\)|'
    r'Main identity / observed model)\s*[:：]', re.I)


def worker_projection(text: str) -> str:
    result: list[str] = []
    hidden = False
    fence: str | None = None
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        mark = re.match(r'^(`{3,}|~{3,})', stripped)
        if mark:
            token = mark.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            if not hidden:
                result.append(line)
            continue
        if fence is None:
            if stripped == '<!-- MAIN-ONLY -->':
                if hidden:
                    raise ValueError('nested MAIN-ONLY block in PLAN')
                hidden = True
                continue
            if stripped == '<!-- /MAIN-ONLY -->':
                if not hidden:
                    raise ValueError('unmatched MAIN-ONLY closing marker in PLAN')
                hidden = False
                continue
        if not hidden and (fence is not None or not MAIN_FIELDS.match(line)):
            result.append(line)
    if hidden:
        raise ValueError('unclosed MAIN-ONLY block in PLAN')
    return ''.join(result)


def extract(plan:Plan,uid:str) -> str:
    byid={u.id:u for u in plan.units}
    if uid not in byid:raise ValueError(f'unknown section/subsection {uid}')
    lines=plan.text.splitlines(keepends=True)
    first=min(u.start for u in plan.units)
    u=byid[uid]
    if plan.features:
        # Keep shared authority while excluding unrelated Feature contracts.
        unrelated={i for f in plan.features if f.id != u.feature_id
                   for i in range(f.start,min(f.end,first))}
        context=''.join(line for i,line in enumerate(lines[:first]) if i not in unrelated)
    else:
        context=''.join(lines[:first])
    if u.parent:
        parent=byid[u.parent]
        context+=''.join(lines[parent.start:parent.end])
        selected=''.join(lines[u.start:u.end])
    else:
        parts=[u]+[c for c in plan.units if c.parent==uid]
        selected=''.join(''.join(lines[c.start:c.end]) for c in parts)
    return worker_projection(context.rstrip()+ '\n\n'+selected.strip()+'\n')


def main(argv:list[str]|None=None)->int:
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    for name in ['validate','list','extract']:
        x=sub.add_parser(name);x.add_argument('plan',type=Path)
        if name=='extract':x.add_argument('unit');x.add_argument('--output',type=Path)
        else:x.add_argument('--json',action='store_true')
    args=p.parse_args(argv)
    try:plan=parse(args.plan.read_text(encoding='utf-8'))
    except (OSError,UnicodeError) as exc:print(f'ERROR: {exc}',file=sys.stderr);return 2
    if args.command=='validate':
        result={'valid':not plan.errors,'sections':sum(u.parent is None for u in plan.units),'subsections':sum(u.parent is not None for u in plan.units),'features':len(plan.features) if plan.features else 1,'errors':plan.errors,'warnings':plan.warnings,'scope':'structure only; no approval/acceptance/actor/test authenticity'}
        if args.json:print(json.dumps(result,ensure_ascii=False,indent=2))
        else:
            for e in plan.errors:print('ERROR: '+e)
            for w in plan.warnings:print('WARNING: '+w)
            print(('VALID' if not plan.errors else 'INVALID')+f" — {result['sections']} sections, {result['subsections']} subsections; structure only")
        return 1 if plan.errors else 0
    if plan.errors:
        print('\n'.join('ERROR: '+e for e in plan.errors),file=sys.stderr);return 1
    if args.command=='list':
        if args.json:print(json.dumps([asdict(u) for u in plan.units],ensure_ascii=False,indent=2))
        else:
            for u in plan.units:print(f"{u.id}\t{u.profile}\t{', '.join(u.depends_on) or 'none'}\t{u.title}")
        return 0
    try:content=extract(plan,args.unit)
    except ValueError as exc:print(str(exc),file=sys.stderr);return 1
    if args.output:
        if args.output.resolve()==args.plan.resolve():
            print('ERROR: extraction must not overwrite the authoritative plan',file=sys.stderr);return 2
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(content,encoding='utf-8')
    else:print(content,end='')
    return 0

if __name__=='__main__':raise SystemExit(main())
