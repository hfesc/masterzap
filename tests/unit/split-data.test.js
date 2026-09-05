import { describe, it, expect } from 'vitest';
import {
  slugify,
  getConversationId,
  groupMessagesByDate,
  buildSearchIndex,
  describeCall,
  normaliseDateRange,
  describeReportDocument,
} from '../../scripts/split_data.mjs';

describe('split_data Node port', () => {
  describe('slugify', () => {
    it('converts names to lower-case url-friendly slugs', () => {
      expect(slugify('Martha Graeff')).toBe('martha-graeff');
      expect(slugify('Alexandre de Moraes')).toBe('alexandre-de-moraes');
    });

    it('strips accents according to Brazilian Portuguese phonetics', () => {
      expect(slugify('Álvaro José Müller')).toBe('alvaro-jose-muller');
      expect(slugify('Célia e João São Paulo')).toBe('celia-e-joao-sao-paulo');
      expect(slugify('Açúcar & Canção')).toBe('acucar-cancao');
      expect(slugify('Iñigo')).toBe('inigo');
    });

    it('handles special characters and whitespace', () => {
      expect(slugify('  --Diretor Paulo Sérgio (BACEN)!!  ')).toBe('diretor-paulo-sergio-bacen');
      expect(slugify('DV / Self')).toBe('dv-self');
    });
  });

  describe('getConversationId', () => {
    it('extracts other participant excluding DV', () => {
      const meta = { participants: ['DV', 'Martha Graeff'] };
      expect(getConversationId(meta)).toBe('martha-graeff');
    });

    it('falls back to joined participants when DV is not present or is the only one', () => {
      expect(getConversationId({ participants: ['DV'] })).toBe('dv');
      expect(getConversationId({ participants: ['Alice', 'Bob'] })).toBe('alice');
    });
  });

  describe('groupMessagesByDate', () => {
    it('groups messages by their date string', () => {
      const msgs = [
        { id: 1, date: '2024-02-10', content: 'hello' },
        { id: 2, date: '2024-02-10', content: 'world' },
        { id: 3, date: '2024-02-11', content: 'next' },
      ];
      const grouped = groupMessagesByDate(msgs);
      expect(Object.keys(grouped)).toEqual(['2024-02-10', '2024-02-11']);
      expect(grouped['2024-02-10']).toHaveLength(2);
      expect(grouped['2024-02-11']).toHaveLength(1);
    });
  });

  describe('buildSearchIndex', () => {
    it('truncates content to max length when message count exceeds 5000', () => {
      const msgs = Array.from({ length: 5001 }, (_, i) => ({
        id: i + 1,
        date: '2024-02-10',
        sender: 'DV',
        type: 'text',
        content: 'A'.repeat(120),
      }));

      const index = buildSearchIndex(msgs);
      expect(index[0].content).toHaveLength(80);
      expect(index[0].content).toBe('A'.repeat(80));
    });

    it('does not truncate content when message count is 5000 or fewer', () => {
      const msgs = [
        {
          id: 1,
          date: '2024-02-10',
          sender: 'DV',
          type: 'text',
          content: 'A'.repeat(120),
        },
      ];

      const index = buildSearchIndex(msgs);
      expect(index[0].content).toHaveLength(120);
    });

    it('filters out system messages and empty content', () => {
      const msgs = [
        { id: 1, date: '2024-02-10', sender: 'DV', type: 'system', content: 'Messages are encrypted' },
        { id: 2, date: '2024-02-10', sender: 'DV', type: 'text', content: '   ' },
        { id: 3, date: '2024-02-10', sender: 'DV', type: 'text', content: null },
        { id: 4, date: '2024-02-10', sender: 'DV', type: 'text', content: 'Real message' },
      ];

      const index = buildSearchIndex(msgs);
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe(4);
    });
  });

  describe('describeCall', () => {
    it('parses Portuguese call records', () => {
      expect(describeCall({ content: 'Chamada de voz — duração 02:49', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'completed',
        duration: '02:49',
        outgoing: true,
      });

      expect(describeCall({ content: 'Chamada de vídeo — duração 12:30', sender: 'Martha Graeff' })).toEqual({
        kind: 'video',
        status: 'completed',
        duration: '12:30',
        outgoing: false,
      });

      expect(describeCall({ content: 'Chamada de voz perdida', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'missed',
        duration: null,
        outgoing: true,
      });

      expect(describeCall({ content: 'Chamada de voz', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'ended',
        duration: null,
        outgoing: true,
      });
    });

    it('parses English call records', () => {
      expect(describeCall({ content: 'Voice call, 3 min', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'completed',
        duration: '3 min',
        outgoing: true,
      });

      expect(describeCall({ content: 'Voice call, 45 sec', sender: 'Martha Graeff' })).toEqual({
        kind: 'voice',
        status: 'completed',
        duration: '45 s',
        outgoing: false,
      });

      expect(describeCall({ content: 'Missed Voice call', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'missed',
        duration: null,
        outgoing: true,
      });

      expect(describeCall({ content: 'Voice call, No answer', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'no_answer',
        duration: null,
        outgoing: true,
      });

      expect(describeCall({ content: 'Voice call, Ended', sender: 'DV' })).toEqual({
        kind: 'voice',
        status: 'ended',
        duration: null,
        outgoing: true,
      });

      expect(describeCall({ content: 'Missed video call, Tap to call back', sender: 'DV' })).toEqual({
        kind: 'video',
        status: 'missed',
        duration: null,
        outgoing: true,
      });
    });

    it('returns null for non-call content', () => {
      expect(describeCall({ content: 'Ola, tudo bem?', sender: 'DV' })).toBeNull();
      expect(describeCall({ content: '', sender: 'DV' })).toBeNull();
    });
  });

  describe('normaliseDateRange', () => {
    it('normalises object shape', () => {
      expect(normaliseDateRange({ start: '2024-01-01', end: '2024-01-02' })).toEqual({
        start: '2024-01-01',
        end: '2024-01-02',
      });
    });

    it('normalises array shape', () => {
      expect(normaliseDateRange(['2024-01-01', '2024-01-02'])).toEqual({
        start: '2024-01-01',
        end: '2024-01-02',
      });
    });
  });

  describe('describeReportDocument', () => {
    it('returns report document metadata with sha256 and pages', () => {
      const doc = describeReportDocument();
      expect(doc).not.toBeNull();
      expect(doc.file).toBe('data/source/IPJ-A-3298613-2026.pdf');
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof doc.pages).toBe('number');
      expect(doc.pages).toBeGreaterThan(0);
    });
  });
});
