// The AI assistant: paste a message from a family (or describe your own day), review what
// Tanpura proposes and what it does to the next bill, then approve. Nothing changes before that.
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Close from '@mui/icons-material/Close';
import Mic from '@mui/icons-material/Mic';
import StopCircle from '@mui/icons-material/StopCircle';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import type { AssistantProposal } from '../../../../shared/assistant';
import { useApplyActions, usePropose, useTeacher } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { toast } from '../../components/toast';
import { Money } from '../../components/ui';
import type { Profession } from '../../../../shared/words';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { formatMonth, plural } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

const EXAMPLES: Record<Profession, string[]> = {
  teaching: [
    'Hi Lakshmi, Aarav has a fever and will miss Saturday. Could we do a makeup on Monday instead? Priya',
    'Meera has exams next week, she will miss Tuesday. No makeup needed, thank you! Sangeetha',
    "I'm unwell tomorrow, please cancel my classes.",
  ],
  client_sessions: [
    'Hi Meera, I have a work trip and will miss this week. Could we do a makeup session on Monday instead? Anjali',
    "Rahul here, I can't make Tuesday's session. No makeup needed, thanks!",
    "I'm unwell tomorrow, please cancel my sessions.",
  ],
};

type Props = { open: boolean; initialMessage: string; onClose: () => void };

export function AssistantDrawer({ open, initialMessage, onClose }: Props) {
  const w = useWords();
  const profession: Profession = useTeacher().data?.profession ?? 'teaching';
  const [message, setMessage] = useState(initialMessage);
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const propose = usePropose();
  const apply = useApplyActions();
  const confirm = useConfirm();
  const ai = useTeacher().data?.integrations.ai;
  const speech = useSpeechInput(
    useCallback((text: string) => setMessage((m) => (m ? `${m} ${text}` : text)), []),
    useCallback((msg: string) => toast.warning(msg), []),
  );

  const read = () =>
    propose.mutate(message, {
      onSuccess: (p) => {
        setProposal(p);
        setChosen(new Set(p.actions.map((_, i) => i)));
      },
    });

  const reset = () => {
    setProposal(null);
    setMessage('');
  };

  // A makeup only makes sense together with the cancellation it replaces.
  const cancelIndexFor = (i: number) => {
    const a = proposal!.actions[i].action;
    return a.kind === 'makeup' ? proposal!.actions.findIndex((x) => x.action.kind === 'cancel' && x.action.sessionId === a.forSessionId) : -1;
  };
  const toggle = (i: number) => {
    const next = new Set(chosen);
    if (next.has(i)) {
      next.delete(i);
      proposal!.actions.forEach((_, j) => cancelIndexFor(j) === i && next.delete(j));
    } else next.add(i);
    setChosen(next);
  };

  const approve = async () => {
    const actions = proposal!.actions.filter((_, i) => chosen.has(i)).map((a) => a.action);
    const ok = await confirm({
      title: `Apply ${plural(actions.length, 'change')}?`,
      message: `The calendar updates now, and the next bill reflects it. You can still change any ${w.class} afterwards.`,
      confirmText: 'Apply',
    });
    if (!ok) return;
    apply.mutate(actions, {
      onSuccess: (r) => {
        toast.success(`${plural(r.applied, 'change')} applied. The bills are updated.`);
        reset();
        onClose();
      },
    });
  };

  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(proposal!.reply);
      toast.success('Reply copied');
    } catch {
      toast.warning('Copy failed. Select the text and copy it instead.');
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}>
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} sx={{ p: 2, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Assistant</Typography>
            <Typography variant="body2" color="text.secondary">
              Paste a message from a family, or tell Tanpura about your day. Nothing changes until you approve.
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close assistant">
            <Close />
          </IconButton>
        </Stack>

        <Stack spacing={2.5} sx={{ p: 2, flex: 1, overflowY: 'auto' }}>
          {!proposal ? (
            <>
              <TextField
                label="Message"
                multiline
                minRows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={EXAMPLES[profession][1].replace(/\..*$/, '.').slice(0, 80)}
                autoFocus
                fullWidth
                helperText={speech.listening ? 'Listening… speak your message, it stops when you pause.' : speech.supported ? 'Type, paste, or tap the mic to speak.' : ' '}
                slotProps={{
                  htmlInput: { maxLength: 2000 },
                  input: speech.supported
                    ? {
                        endAdornment: (
                          <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                            <Tooltip title={speech.listening ? 'Stop listening' : 'Speak a message'}>
                              <IconButton onClick={speech.toggle} color={speech.listening ? 'error' : 'primary'} aria-label={speech.listening ? 'Stop listening' : 'Speak a message'}>
                                {speech.listening ? <StopCircle /> : <Mic />}
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      }
                    : undefined,
                }}
              />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Try an example
                </Typography>
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  {EXAMPLES[profession].map((ex) => (
                    <Chip key={ex} label={ex} variant="outlined" onClick={() => setMessage(ex)} sx={{ height: 'auto', py: 0.75, justifyContent: 'flex-start', '& .MuiChip-label': { whiteSpace: 'normal' } }} />
                  ))}
                </Stack>
              </Box>
              {ai === 'mock' && <Alert severity="info">No Gemini key: Tanpura reads messages with its built-in rules for now.</Alert>}
            </>
          ) : (
            <Proposal proposal={proposal} chosen={chosen} onToggle={toggle} cancelIndexFor={cancelIndexFor} onCopy={copyReply} />
          )}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider', justifyContent: 'flex-end' }}>
          {!proposal ? (
            <Button variant="contained" onClick={read} loading={propose.isPending} loadingPosition="start" disabled={message.trim().length < 3}>
              {propose.isPending ? 'Reading the message…' : 'Read message'}
            </Button>
          ) : (
            <>
              <Button onClick={reset} disabled={apply.isPending}>
                Start over
              </Button>
              <Button variant="contained" onClick={approve} loading={apply.isPending} disabled={!chosen.size}>
                Apply {chosen.size ? plural(chosen.size, 'change') : 'changes'}
              </Button>
            </>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}

type ProposalProps = { proposal: AssistantProposal; chosen: Set<number>; onToggle: (i: number) => void; cancelIndexFor: (i: number) => number; onCopy: () => void };

function Proposal({ proposal, chosen, onToggle, cancelIndexFor, onCopy }: ProposalProps) {
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          What Tanpura understood
        </Typography>
        <Chip size="small" variant="outlined" label={proposal.source === 'ai' ? 'Read by Gemini' : 'Read by built-in rules'} />
      </Stack>
      <Alert severity="info" icon={false}>
        {proposal.summary}
      </Alert>
      {proposal.warnings.map((w) => (
        <Alert key={w} severity="warning">
          {w}
        </Alert>
      ))}

      {proposal.actions.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Proposed changes
          </Typography>
          <Stack spacing={1} divider={<Divider flexItem />}>
            {proposal.actions.map((a, i) => {
              const needs = cancelIndexFor(i);
              return (
                <FormControlLabel
                  key={i}
                  sx={{ alignItems: 'flex-start', m: 0 }}
                  control={<Checkbox checked={chosen.has(i)} disabled={needs >= 0 && !chosen.has(needs)} onChange={() => onToggle(i)} sx={{ mt: -0.5 }} />}
                  label={
                    <Box>
                      <Typography sx={{ fontWeight: 500 }}>{a.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {a.effect}
                      </Typography>
                    </Box>
                  }
                />
              );
            })}
          </Stack>
        </Box>
      )}

      {proposal.impact.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Effect on the {formatMonth(proposal.impactMonth)} bill (all changes)
          </Typography>
          <Stack spacing={0.5}>
            {proposal.impact.map((b) => (
              <Stack key={b.studentId} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography>{b.studentName}</Typography>
                <Typography>
                  <Money amount={b.before} currency={b.currency} /> → <Money amount={b.after} currency={b.currency} strong />
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {proposal.reply && (
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2">Suggested reply</Typography>
            <Tooltip title="Copy reply">
              <IconButton size="small" onClick={onCopy} aria-label="Copy reply">
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography sx={{ whiteSpace: 'pre-wrap', bgcolor: 'background.default', p: 1.5, borderRadius: 1 }}>{proposal.reply}</Typography>
        </Box>
      )}
    </>
  );
}
