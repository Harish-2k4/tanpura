// Asked once, at first sign-in: the kind of work being billed. It sets the words the app uses
// (students and classes, or clients and sessions); the billing works the same either way.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { PROFESSIONS, WORDS, type Profession } from '../../../../shared/words';
import { useChooseProfession } from '../../api/queries';
import { Brand } from '../../components/AppLayout';

export function WorkTypePage() {
  const [choice, setChoice] = useState<Profession | null>(null);
  const choose = useChooseProfession();

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, py: 4, bgcolor: 'background.default' }}>
      <Stack spacing={3} sx={{ width: '100%', maxWidth: 520 }}>
        <Brand size="large" />
        <Box>
          <Typography variant="h5" component="h1">
            What kind of work do you bill for?
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Asked once. It only changes the words Tanpura uses.
          </Typography>
        </Box>
        <Stack spacing={1.5} role="radiogroup" aria-label="Kind of work">
          {PROFESSIONS.map((p) => (
            <Card key={p} sx={{ borderColor: choice === p ? 'primary.main' : undefined, borderWidth: choice === p ? 2 : 1 }}>
              <CardActionArea onClick={() => setChoice(p)} role="radio" aria-checked={choice === p}>
                <CardContent sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <Radio checked={choice === p} tabIndex={-1} sx={{ p: 0.5 }} slotProps={{ input: { 'aria-hidden': true } }} />
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>{WORDS[p].profession}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {WORDS[p].examples}
                    </Typography>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
        <Button variant="contained" size="large" disabled={!choice} loading={choose.isPending} onClick={() => choice && choose.mutate(choice)}>
          Continue
        </Button>
      </Stack>
    </Box>
  );
}
