import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { logActivity } from '../src/lib/activity.ts';

// Single agency-ops CLI. Subcommands:
//   user add <email> <name> <role>
//   user list
//   creator assign <creator_id> <user_id>
//   creator tier <creator_id> <a|b|c|dev>
//   candidate add <name> <handle_tiktok> <niche>
//   candidate advance <candidate_id> <stage> [note]
//   candidate list [stage]
//   campaign new <brand> <campaign_name> <budget> <start_date> <end_date>
//   campaign assign <campaign_id> <creator_id> <fee> <deliverables_json>
//   campaign status <campaign_id> <status>
//   campaign list [status]
//   brief new <creator_id> <week_of> <concept> [campaign_assignment_id]
//   brief list <creator_id>
//   brief fulfill <brief_id> <post_id>
//   comm log <creator_id|candidate_id> <channel> <summary>
//   comm history <creator_id|candidate_id>
//   compliance list
//   compliance resolve <flag_id> <user_id> <note>

function usage() {
  console.error(`agency CLI

  user add <email> <name> <owner|manager|coordinator|viewer>
  user list

  creator assign <creator_id> <user_id>
  creator tier <creator_id> <a|b|c|dev>

  candidate add <name> <handle_tiktok> <niche> [owner_id]
  candidate advance <candidate_id> <discovered|reaching_out|in_conversation|tryout|signed|declined|dormant> [note]
  candidate list [stage]

  campaign new <brand> <campaign_name> <budget_usd> <start_date> <end_date>
  campaign assign <campaign_id> <creator_id> <fee_usd> <deliverables_json>
  campaign status <campaign_id> <pitching|in_negotiation|booked|in_production|live|wrapped|cancelled>
  campaign list [status]

  brief new <creator_id> <week_of> <concept> [campaign_assignment_id]
  brief list <creator_id>
  brief fulfill <brief_id> <post_id>

  comm log <creator|candidate> <id> <channel> <summary>
  comm history <creator|candidate> <id>

  compliance list
  compliance resolve <flag_id> <user_id> <note>
`);
}

async function user(args: string[]) {
  const sub = args[0];
  if (sub === 'add') {
    const [, email, name, role] = args;
    if (!email || !name || !role) return usage();
    const { data, error } = await supabase
      .from('workspace_users')
      .insert({ email, name, role })
      .select()
      .single();
    if (error) throw error;
    console.log(data);
    await logActivity({ action: 'user.add', entity_type: 'workspace_user', entity_id: data.id });
  } else if (sub === 'list') {
    const { data, error } = await supabase.from('workspace_users').select('id, email, name, role, active');
    if (error) throw error;
    console.table(data);
  } else usage();
}

async function creator(args: string[]) {
  const sub = args[0];
  if (sub === 'assign') {
    const [, creatorId, userId] = args;
    if (!creatorId || !userId) return usage();
    const { error } = await supabase
      .from('creators')
      .update({ assigned_coordinator_id: userId })
      .eq('id', creatorId);
    if (error) throw error;
    await logActivity({
      action: 'creator.assign',
      entity_type: 'creator',
      entity_id: creatorId,
      payload: { coordinator_id: userId },
    });
    console.log('ok');
  } else if (sub === 'tier') {
    const [, creatorId, tier] = args;
    if (!creatorId || !tier) return usage();
    const { error } = await supabase.from('creators').update({ tier }).eq('id', creatorId);
    if (error) throw error;
    await logActivity({ action: 'creator.tier', entity_type: 'creator', entity_id: creatorId, payload: { tier } });
    console.log('ok');
  } else usage();
}

async function candidate(args: string[]) {
  const sub = args[0];
  if (sub === 'add') {
    const [, name, handle, niche, ownerId] = args;
    if (!name) return usage();
    const { data, error } = await supabase
      .from('casting_candidates')
      .insert({
        name,
        handle_tiktok: handle ?? null,
        niche: niche ?? null,
        owner_id: ownerId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    console.log(data);
    await logActivity({ action: 'candidate.add', entity_type: 'candidate', entity_id: data.id });
  } else if (sub === 'advance') {
    const [, id, stage, note] = args;
    if (!id || !stage) return usage();
    const update: Record<string, unknown> = { stage, updated_at: new Date().toISOString() };
    if (note) update.notes = note;
    const { error } = await supabase.from('casting_candidates').update(update).eq('id', id);
    if (error) throw error;
    await logActivity({
      action: 'candidate.advance',
      entity_type: 'candidate',
      entity_id: id,
      payload: { stage, note },
    });
    console.log('ok');
  } else if (sub === 'list') {
    const stage = args[1];
    let q = supabase
      .from('casting_candidates')
      .select('id, name, handle_tiktok, niche, stage, owner_id, next_touch_at')
      .order('updated_at', { ascending: false });
    if (stage) q = q.eq('stage', stage);
    const { data, error } = await q;
    if (error) throw error;
    console.table(data);
  } else usage();
}

async function campaign(args: string[]) {
  const sub = args[0];
  if (sub === 'new') {
    const [, brand, name, budget, startDate, endDate] = args;
    if (!brand || !name) return usage();
    const { data, error } = await supabase
      .from('brand_campaigns')
      .insert({
        brand_name: brand,
        campaign_name: name,
        budget_usd: budget ? Number(budget) : null,
        start_date: startDate ?? null,
        end_date: endDate ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    console.log(data);
    await logActivity({ action: 'campaign.new', entity_type: 'campaign', entity_id: data.id });
  } else if (sub === 'assign') {
    const [, campaignId, creatorId, fee, deliverables] = args;
    if (!campaignId || !creatorId || !deliverables) return usage();
    const { data, error } = await supabase
      .from('campaign_assignments')
      .insert({
        campaign_id: campaignId,
        creator_id: creatorId,
        fee_usd: fee ? Number(fee) : null,
        deliverables: JSON.parse(deliverables),
      })
      .select()
      .single();
    if (error) throw error;
    console.log(data);
    await logActivity({
      action: 'campaign.assign',
      entity_type: 'campaign',
      entity_id: campaignId,
      payload: { creator_id: creatorId, fee_usd: fee },
    });
  } else if (sub === 'status') {
    const [, id, status] = args;
    if (!id || !status) return usage();
    const { error } = await supabase.from('brand_campaigns').update({ status }).eq('id', id);
    if (error) throw error;
    await logActivity({ action: 'campaign.status', entity_type: 'campaign', entity_id: id, payload: { status } });
    console.log('ok');
  } else if (sub === 'list') {
    const status = args[1];
    let q = supabase
      .from('brand_campaigns')
      .select('id, brand_name, campaign_name, status, budget_usd, start_date, end_date');
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    console.table(data);
  } else usage();
}

async function brief(args: string[]) {
  const sub = args[0];
  if (sub === 'new') {
    const [, creatorId, weekOf, concept, assignmentId] = args;
    if (!creatorId || !weekOf || !concept) return usage();
    const { data, error } = await supabase
      .from('content_briefs')
      .insert({
        creator_id: creatorId,
        week_of: weekOf,
        concept,
        campaign_assignment_id: assignmentId ?? null,
        status: 'published',
      })
      .select()
      .single();
    if (error) throw error;
    console.log(data);
    await logActivity({ action: 'brief.new', entity_type: 'brief', entity_id: data.id });
  } else if (sub === 'list') {
    const [, creatorId] = args;
    if (!creatorId) return usage();
    const { data, error } = await supabase
      .from('content_briefs')
      .select('id, week_of, concept, status, due_at, fulfilled_post_id')
      .eq('creator_id', creatorId)
      .order('week_of', { ascending: false });
    if (error) throw error;
    console.table(data);
  } else if (sub === 'fulfill') {
    const [, briefId, postId] = args;
    if (!briefId || !postId) return usage();
    const { error } = await supabase
      .from('content_briefs')
      .update({ fulfilled_post_id: postId, status: 'posted' })
      .eq('id', briefId);
    if (error) throw error;
    await logActivity({ action: 'brief.fulfill', entity_type: 'brief', entity_id: briefId, payload: { post_id: postId } });
    console.log('ok');
  } else usage();
}

async function comm(args: string[]) {
  const sub = args[0];
  if (sub === 'log') {
    const [, kind, id, channel, ...summaryParts] = args;
    if (!kind || !id || !channel || summaryParts.length === 0) return usage();
    const summary = summaryParts.join(' ');
    const insert: Record<string, unknown> = { channel, summary };
    if (kind === 'creator') insert.creator_id = id;
    else if (kind === 'candidate') insert.candidate_id = id;
    else return usage();
    const { data, error } = await supabase.from('comm_log').insert(insert).select().single();
    if (error) throw error;
    console.log(data);
  } else if (sub === 'history') {
    const [, kind, id] = args;
    if (!kind || !id) return usage();
    const col = kind === 'creator' ? 'creator_id' : 'candidate_id';
    const { data, error } = await supabase
      .from('comm_log')
      .select('id, channel, summary, created_at, author_id')
      .eq(col, id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    console.table(data);
  } else usage();
}

async function compliance(args: string[]) {
  const sub = args[0];
  if (sub === 'list') {
    const { data, error } = await supabase
      .from('compliance_flags')
      .select('id, post_id, kind, severity, detail, created_at')
      .is('resolved_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    console.table(data);
  } else if (sub === 'resolve') {
    const [, flagId, userId, ...noteParts] = args;
    if (!flagId || !userId) return usage();
    const note = noteParts.join(' ');
    const { error } = await supabase
      .from('compliance_flags')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_note: note || null,
      })
      .eq('id', flagId);
    if (error) throw error;
    await logActivity({
      action: 'compliance.resolve',
      entity_type: 'compliance_flag',
      entity_id: flagId,
      user_id: userId,
      payload: { note },
    });
    console.log('ok');
  } else usage();
}

async function main() {
  const [domain, ...rest] = process.argv.slice(2);
  if (!domain) return usage();
  switch (domain) {
    case 'user':
      return user(rest);
    case 'creator':
      return creator(rest);
    case 'candidate':
      return candidate(rest);
    case 'campaign':
      return campaign(rest);
    case 'brief':
      return brief(rest);
    case 'comm':
      return comm(rest);
    case 'compliance':
      return compliance(rest);
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
