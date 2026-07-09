import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../config/supabase';
import { mixpanel } from '../../services/mixpanel';


const StopStayCard = ({ destination, lang, onContentReady }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('stay');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const contentReadySent = useRef(false);

  const placeId = destination?.placeId || destination?.id;
  const placeName = destination?.name || destination?.name_en;

  useEffect(() => {
    contentReadySent.current = false;
  }, [placeId]);

  useEffect(() => {
    if (contentReadySent.current || loading || error || !data) return;
    const hasContent = data.stay || data.fact || data.when;
    if (hasContent) {
      contentReadySent.current = true;
      onContentReady?.();
    }
  }, [loading, error, data, onContentReady]);

  const openStayLink = (url, linkName) => {
    let linkDomain = null;
    try {
      linkDomain = new URL(url).hostname.replace(/^www\./, '');
    } catch (_) { /* ignore */ }
    mixpanel.track('Stop Stay Link Tapped', {
      place_id: placeId,
      place_name: placeName,
      link_name: linkName,
      tab: activeTab,
      link_domain: linkDomain,
    });
    Linking.openURL(url);
  };

  const handleTabPress = (tabId) => {
    if (tabId !== activeTab) {
      mixpanel.track('Stop Stay Tab Changed', {
        place_id: placeId,
        place_name: placeName,
        tab: tabId,
      });
    }
    setActiveTab(tabId);
  };

  useEffect(() => {
    const placeId = destination?.placeId || destination?.id;
    if (placeId && lang) {
      fetchPlaceDetail(placeId);
    }
  }, [destination, lang]);

  const fetchPlaceDetail = async (placeId) => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: result, error: rpcError } = await supabase.rpc('get_place_detail', {
        p_place_id: placeId,
        p_lang: lang
      });

      if (rpcError) {
        throw rpcError;
      }

      if (!result || (!result.stay && !result.fact && !result.when)) {
        setData(null);
        setLoading(false);
        return;
      }

      setData(result);
    } catch (err) {
      if (__DEV__) console.warn('StopStayCard failed to fetch place detail:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getDotColor = (stayText) => {
    if (!stayText) return '#ff9500';
    
    const text = stayText.toLowerCase();
    
    // Green: free options
    if (text.includes('gratis') || text.includes('free') || text.includes('kostenlos') || text.includes('umsonst')) {
      return '#34c759';
    }
    
    // Red: prohibited/risky
    if (text.includes('verboten') || text.includes('riskant') || text.includes('illegal') || text.includes('prohibited')) {
      return '#ff3b30';
    }
    
    return '#ff9500'; // orange default
  };

  const findCampsiteNames = (stayText) => {
    if (!stayText) return [];
    
    // Patterns to match campsite/stellplatz names
    const patterns = [
      // "Wohnmobiloase Berlin", "Campingplatz am Krossinsee"
      /(?:Wohnmobiloase|Campingplatz|Stellplatz|Wohnmobilpark|Camping|Campsite)\s+[A-Za-z][A-Za-z\s\-üöäÜÖÄß]*[A-Za-z]/g,
      // "Camping XYZ", "Stellplatz ABC"
      /[A-Z][a-zA-ZüöäÜÖÄß]*(?:\s+[a-zA-ZüöäÜÖÄß]+)*\s+(?:Camping|Campingplatz|Stellplatz|Wohnmobilpark)/g,
    ];

    const names = [];
    for (const pattern of patterns) {
      const matches = stayText.match(pattern);
      if (matches) {
        matches.forEach(match => {
          let name = match.trim();
          // Clean up trailing punctuation
          name = name.replace(/\s*[–\-—:,\.]+\s*$/, '');
          if (name.length > 5 && name.length < 60) {
            names.push({
              name: name,
              startIndex: stayText.indexOf(match),
              endIndex: stayText.indexOf(match) + match.length
            });
          }
        });
      }
    }
    
    // Sort by position in text
    return names.sort((a, b) => a.startIndex - b.startIndex);
  };

  // Parse "Label: Name – details" lines into structured blocks
  const parseStayBlocks = (stayText) => {
    if (!stayText) return [];

    // Normalize: ". KnownLabel:" mid-sentence → newline before it
    const sectionKeywords = [
      'Alternative', 'Alternativ',
      'Wildcampen', 'Wildcamping', 'Wild camping', 'Wildes Campen', 'Wildes Zelten',
      'Freies Camping', 'Free camping', 'Free Camping',
      'Freistehen', 'Freistehend',
      'Beste Option', 'Best option',
    ];
    const escaped = sectionKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // Match ". Keyword:" or "). – Keyword:" or ". – Keyword:" or " – Keyword:"
    const keywordPattern = new RegExp(
      `(?:[.)]+\\s*[–—-]?\\s+|[–—-]\\s+)(${escaped}):`,
      'g'
    );
    const normalized = stayText.replace(keywordPattern, (_, kw) => `\n${kw}:`);

    return normalized.split('\n').filter(Boolean).map((line, index) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return { label: null, name: line, details: null, type: 'plain' };

      const label = line.slice(0, colonIdx).trim();
      const content = line.slice(colonIdx + 1).trim();

      // Extract parenthetical from name: "Name (extra)" → name + paren
      const parenMatch = content.match(/^([^(]+?)\s*(\([^)]+\))\s*(.*)$/);
      const cleanContent = parenMatch
        ? `${parenMatch[1].trim()}${parenMatch[3] ? ` ${parenMatch[3].trim()}` : ''}`
        : content;
      const parenthetical = parenMatch ? parenMatch[2] : null;

      const labelLower = label.toLowerCase();
      const contentLower = content.toLowerCase();
      const isWildcamp =
        labelLower.includes('wild') ||
        labelLower.includes('frei') ||
        labelLower.includes('free') ||
        labelLower.includes('zelten') ||
        contentLower.includes('verboten') ||
        contentLower.includes('illegal') ||
        contentLower.includes('prohibited') ||
        contentLower.includes('geduldet') ||
        contentLower.includes('toleriert');

      // Try splitting name from details on cleanContent (parenthetical already extracted)
      let name = cleanContent;
      let details = null;

      const dashMatch = cleanContent.match(/ [–—-] /);
      if (dashMatch) {
        const i = cleanContent.indexOf(dashMatch[0]);
        name = cleanContent.slice(0, i).trim();
        details = cleanContent.slice(i + dashMatch[0].length).trim();
      } else {
        const periodMatch = cleanContent.match(/(\)?)\.\s+(?=[A-ZÜÄÖ][a-zäöüß])/);
        if (periodMatch) {
          const i = cleanContent.indexOf(periodMatch[0]);
          name = cleanContent.slice(0, i + periodMatch[1].length + 1).trim();
          details = cleanContent.slice(i + periodMatch[0].length).trim();
        }
      }

      // Strip distance/location suffix from name (e.g. ", 12km südlich") → prepend to details
      const distanceMatch = name.match(/^(.+?),\s+(\d+[\s,]*km\b.*)$/i);
      if (distanceMatch) {
        name = distanceMatch[1].trim();
        const distancePart = distanceMatch[2].trim();
        details = details ? `${distancePart}, ${details}` : distancePart;
      }

      return {
        label,
        name,
        parenthetical,
        details,
        type: isWildcamp ? 'wildcamp' : index === 0 ? 'main' : 'secondary',
      };
    });
  };

  // Split text on [,;] or newline but never inside parentheses
  const splitOutsideParens = (text) => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;\n]/.test(ch)) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };

  const isFallbackStay = (stayText) => {
    if (!stayText) return false;
    // Only treat as fallback if short AND no structured "Label: content" blocks
    const hasStructure = /^(Beste Option|Best option|Alternative|Alternativ|Wildcampen|Wildes|Freistehen|Freies):/im.test(stayText);
    if (hasStructure) return false;
    const t = stayText.toLowerCase();
    return (
      stayText.length < 120 && (
        t.includes('park4night') ||
        t.includes('ungeprüft') ||
        t.includes('unverifiziert') ||
        t.includes('unverified') ||
        t.includes('keine verlässlichen') ||
        t.includes('keine infos') ||
        t.includes('nicht geprüft') ||
        t.includes('check park4night')
      )
    );
  };

  const renderFallbackStay = (stayText) => {
    // Split on " - ", " – ", or ". " into two short lines
    const sepMatch = stayText.match(/ [–—-] |\. /);
    const lines = sepMatch
      ? [stayText.slice(0, stayText.indexOf(sepMatch[0])).trim(),
         stayText.slice(stayText.indexOf(sepMatch[0]) + sepMatch[0].length).trim()]
      : [stayText];

    return (
      <View style={styles.fallbackBlock}>
        {lines.map((line, i) => (
          <Text key={i} style={i === 0 ? styles.fallbackLine1 : styles.fallbackLine2}>
            {i === 1 ? '→ ' : ''}{line}
          </Text>
        ))}
      </View>
    );
  };

  // Render a campsite name, splitting on " oder " into individual link lines
  const renderCampsiteNames = (name, link) => {
    const parts = name.split(/ oder /i).map(p => p.trim()).filter(Boolean);
    if (parts.length === 1) {
      return link
        ? <Text style={[styles.blockNameMain, styles.blockNameLink]} numberOfLines={2} onPress={() => openStayLink(link, name)}>{name}<Text style={styles.linkArrow}> ↗</Text></Text>
        : <Text style={styles.blockNameMain} numberOfLines={2}>{name}</Text>;
    }
    const town = destination?.name_en || destination?.name || '';
    return parts.map((part, idx) => {
      const partUrl = link && idx === 0
        ? link
        : `https://www.google.com/maps/search/${encodeURIComponent(part + (town ? ' ' + town : ''))}`;
      return (
        <Text key={idx} style={[styles.blockNameMain, styles.blockNameLink]} numberOfLines={2} onPress={() => openStayLink(partUrl, part)}>
          {part}<Text style={styles.linkArrow}> ↗</Text>
        </Text>
      );
    });
  };

  const renderStayBlocks = (stayText, campsiteLink1, campsiteLink2) => {
    if (isFallbackStay(stayText)) return renderFallbackStay(stayText);

    const blocks = parseStayBlocks(stayText);
    const links = [campsiteLink1, campsiteLink2].filter(Boolean);

    let linkIndex = 0;

    return (
      <View>
        {blocks.map((block, i) => {
          const link = block.type !== 'wildcamp' && links[linkIndex] ? links[linkIndex] : null;
          if (block.type !== 'wildcamp' && link) linkIndex++;

          if (block.type === 'wildcamp') {
            return (
              <View key={i} style={i > 0 ? styles.blockSeparator : null}>
                {block.label && <Text style={styles.blockLabelMuted}>{block.label}</Text>}
                <Text style={styles.wildcampText}>{block.name.charAt(0).toUpperCase() + block.name.slice(1)}{block.details ? ` – ${block.details}` : ''}</Text>
              </View>
            );
          }

          if (block.type === 'secondary') {
            return (
              <View key={i} style={styles.blockSeparator}>
                {block.label && <Text style={styles.blockLabel}>{block.label}</Text>}
                {renderCampsiteNames(block.name, link)}
                {block.parenthetical && <Text style={styles.blockParenthetical}>{block.parenthetical}</Text>}
                {block.details && <Text style={styles.blockDetails}>{block.details}</Text>}
              </View>
            );
          }

          // main
          return (
            <View key={i}>
              {block.label && <Text style={styles.blockLabel}>{block.label}</Text>}
              {renderCampsiteNames(block.name, link)}
              {block.parenthetical && <Text style={styles.blockParenthetical}>{block.parenthetical}</Text>}
              {block.details && (
                <Text style={styles.blockDetails}>
                  {block.details.split(/,\s+|·/).map(s => s.trim()).filter(Boolean).join('\n')}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // Split fact text into short lines at " – " or ". "
  const renderFactText = (factText) => {
    if (!factText) return null;
    // Split on " – " or on ". " but NOT after known abbreviations
    const abbrevPattern = /\b(n|v|Chr|ca|bzw|z\.B|d\.h|u\.a|etc|Dr|Prof|Jr|Sr|vs|Mr|Mrs|Ms|St|Str|Nr|usw|ggf|inkl|exkl|ca|max|min)\.\s/g;
    const placeholder = '\x00';
    const protected_ = factText.replace(abbrevPattern, m => m.replace('. ', `.${placeholder}`));
    const lines = protected_
      .split(/(?<=[a-züöäßA-ZÜÖÄ]\.)\s+(?=[A-ZÜÄÖ][a-züöäß])/)
      .map(s => s.replace(new RegExp(placeholder, 'g'), ' ').trim())
      .filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1));
    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
    if (lines.length <= 1) return <Text style={styles.contentText}>{capitalize(factText)}</Text>;
    return (
      <View>
        {lines.map((line, i) => (
          <Text key={i} style={[styles.contentText, i > 0 && styles.factLineSpacer]}>{line}</Text>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#A06035" />
      </View>
    );
  }

  if (error || !data) {
    return null;
  }

  const tabs = [
    { id: 'stay', label: t('stayCard.stay', 'Stay'), content: data.stay },
    { id: 'facts', label: t('stayCard.facts', 'Facts'), content: data.fact },
    { id: 'when', label: t('stayCard.when', 'When'), content: data.when },
  ].filter(tab => tab.content);

  // Pick correct language variant for new fields
  const langKey = ['de', 'fr'].includes(lang) ? lang : 'en';
  const intro = data[`intro_${langKey}`] || null;
  const vehicleWarning = data[`vehicle_warning_${langKey}`] || null;
  const seasonal = data[`seasonal_${langKey}`] || null;

  // Camping link fallback — prefer stay_en for extraction, fall back to stay (current lang)
  // Extract campsite name after a keyword up to the next dash separator or newline
  const extractCampsiteName = (text, ...keywords) => {
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) {
        const after = text.slice(idx + kw.length).trim();
        return after.split(/\s[–\-]\s|\n|\s+\(/)[0].trim() || null;
      }
    }
    return null;
  };

  // Use stay_en for keyword detection; fall back to current-lang stay if stay_en absent
  const stayForExtraction = data.stay_en || data.stay || '';

  const campsite1Name = extractCampsiteName(stayForExtraction, 'best option:', 'beste option:');
  const campsite2Name = extractCampsiteName(stayForExtraction, 'alternative:');
  const townName = destination?.name_en || destination?.name || '';

  const campingUrl1 = data.camping_link_1
    ?? (campsite1Name
      ? `https://www.google.com/maps/search/${encodeURIComponent(campsite1Name + (townName ? ' ' + townName : ''))}`
      : null);
  const campingUrl2 = data.camping_link_2
    ?? (campsite2Name
      ? `https://www.google.com/maps/search/${encodeURIComponent(campsite2Name + (townName ? ' ' + townName : ''))}`
      : null);

  if (tabs.length === 0) {
    return null; // No content to show
  }

  const activeTabData = tabs.find(tab => tab.id === activeTab) || tabs[0];

  return (
    <View style={styles.container}>
      {/* Intro box */}
      {intro && (
        <View style={styles.introBox}>
          <Text style={styles.introText}>{intro}</Text>
        </View>
      )}

      {/* Tab Header */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tab,
              activeTab === tab.id && styles.activeTab
            ]}
            onPress={() => handleTabPress(tab.id)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.id && styles.activeTabText
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={styles.contentContainer}>
        {activeTab === 'stay' && (
          <View>
            {renderStayBlocks(data.stay, campingUrl1, campingUrl2)}
            {vehicleWarning && (
              <View style={styles.extraFieldBlock}>
                <Text style={styles.extraFieldLabel}><Text style={styles.extraFieldEmoji}>🚐</Text> {lang === 'fr' ? 'VÉHICULE' : lang === 'de' ? 'FAHRZEUG' : 'VEHICLE'}</Text>
                {splitOutsideParens(vehicleWarning).filter(Boolean).map((line, i) => (
                  <Text key={i} style={styles.extraFieldText}>{'• '}{line.trim()}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === 'facts' && (
          <View>
            {renderFactText(data.fact)}
            {data.entry_fee && (() => {
              const colonIdx = data.entry_fee.indexOf(':');
              const label = colonIdx !== -1 ? data.entry_fee.slice(0, colonIdx).trim() : null;
              const value = colonIdx !== -1 ? data.entry_fee.slice(colonIdx + 1).trim() : data.entry_fee;
              return (
                <View style={styles.entryFeePill}>
                  {label && <Text style={styles.entryFeeLabel}>{label}</Text>}
                  <Text style={styles.entryFeeValue}>{value}</Text>
                </View>
              );
            })()}
          </View>
        )}

        {activeTab === 'when' && (
          <View>
            {seasonal && (
              <View style={styles.extraFieldBlock}>
                <Text style={styles.extraFieldLabel}><Text style={styles.extraFieldEmoji}>📅</Text> {lang === 'fr' ? 'SAISON' : lang === 'de' ? 'SAISON' : 'SEASON'}</Text>
                <Text style={styles.extraFieldText}>{seasonal}</Text>
              </View>
            )}
            <Text style={[styles.whenLabel, seasonal && { marginTop: 14 }]}>{lang === 'de' ? 'Beste Zeit' : 'Best time'}</Text>
            <Text style={styles.contentText}>{data.when}</Text>
            {data.avoid && (
              <View style={styles.avoidBlock}>
                <Text style={styles.whenLabel}>{lang === 'de' ? 'Weniger ideal' : 'Less ideal'}</Text>
                <Text style={styles.avoidText}>{data.avoid}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FDFAF7',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
    shadowColor: '#3A2A1A',
  },
  introBox: {
    backgroundColor: 'rgba(200, 120, 64, 0.07)',
    borderLeftWidth: 2,
    borderLeftColor: '#C07840',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  introText: {
    fontSize: 13,
    color: '#555555',
    lineHeight: 17,
  },
  extraFieldBlock: {
    marginTop: 18,
  },
  extraFieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999999',
    letterSpacing: 0.3,
    marginBottom: 5,
  },
  extraFieldEmoji: {
    fontSize: 10,
    opacity: 0.7,
  },
  extraFieldText: {
    fontSize: 13,
    color: '#3a3a3c',
    lineHeight: 20,
    marginBottom: 2,
  },
  tabBar: {
    backgroundColor: '#EDE8E2',
    borderRadius: 9,
    padding: 3,
    flexDirection: 'row',
    gap: 3,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#A06035',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9A8E82',
  },
  activeTabText: {
    color: '#ffffff',
  },
  contentContainer: {
    minHeight: 40,
  },
  contentText: {
    color: '#3a3a3c',
    fontSize: 14,
    lineHeight: 22,
  },
  // Fallback/unverified stay state
  fallbackBlock: {
    paddingVertical: 6,
  },
  fallbackLine1: {
    fontSize: 13,
    color: '#999999',
    fontWeight: '500',
    lineHeight: 20,
  },
  fallbackLine2: {
    fontSize: 13,
    color: '#A06035',
    fontWeight: '400',
    lineHeight: 20,
    marginTop: 4,
  },

  // Stay blocks
  blockLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8a7560',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  blockLabelMuted: {
    fontSize: 10,
    fontWeight: '600',
    color: '#b0b0b0',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  blockNameMain: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1c1e',
    lineHeight: 22,
    marginBottom: 3,
  },
  blockNameLink: {
    color: '#8A5428',
    textDecorationLine: 'underline',
  },
  linkArrow: {
    fontSize: 11,
    fontWeight: '400',
    textDecorationLine: 'none',
    color: '#8A5428',
  },
  blockParenthetical: {
    fontSize: 13,
    color: '#888888',
    lineHeight: 18,
    marginBottom: 2,
  },
  blockDetails: {
    fontSize: 13,
    color: '#444444',
    fontWeight: '500',
    lineHeight: 20,
  },
  blockSeparator: {
    marginTop: 18,
  },
  blockNameSecondary: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3a3a3c',
    lineHeight: 20,
    marginBottom: 2,
  },
  blockDetailsMuted: {
    fontSize: 12,
    color: '#888888',
    lineHeight: 18,
  },
  wildcampText: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },
  factLineSpacer: {
    marginTop: 6,
  },
  linkText: {
    color: '#8A5428',
    textDecorationLine: 'underline',
  },
  whenLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8a7560',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  avoidBlock: {
    marginTop: 14,
  },
  avoidText: {
    color: '#5a5a5a',
    fontSize: 14,
    lineHeight: 22,
  },
  entryFeePill: {
    backgroundColor: 'rgba(160, 96, 53, 0.07)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  entryFeeLabel: {
    fontSize: 11,
    color: '#9A7040',
    fontWeight: '500',
    marginBottom: 2,
  },
  entryFeeValue: {
    fontSize: 15,
    color: '#6E4220',
    fontWeight: '600',
  },
});

export default StopStayCard;