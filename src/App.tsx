import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Search, ShieldAlert, ShieldCheck, Link as LinkIcon, Loader2, ChevronRight, ChevronDown, CheckSquare, Square, AlertTriangle, RefreshCw, Globe, Calendar, BookOpen, MapPin, Share2, Download, Printer, Sun, Moon, BellRing, LogOut, X, Map as MapIcon, List } from 'lucide-react';
import { cn } from './lib/utils';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Conference {
  theme: string;
  topics: string;
  date: string;
  location: string;
  deadline: string;
  presentationType: string;
  predatoryAnalysis: string;
  url: string;
  originalTextQuote: string;
  urlStatus?: 'pending' | 'valid' | 'invalid' | 'fixing';
  lat?: number;
  lng?: number;
}

const LOCATIONS = [
  {
    name: '亞洲 (Asia)',
    children: [
      { name: '台灣 (Taiwan)', children: [{ name: '台北 (Taipei)' }, { name: '新竹 (Hsinchu)' }, { name: '台中 (Taichung)' }, { name: '高雄 (Kaohsiung)' }, { name: '花東 (Hualien-Taitung)' }] },
      { 
        name: '中國 (China)', 
        children: [
          { name: '華北 (North China)', children: [{ name: '北京 (Beijing)' }, { name: '天津 (Tianjin)' }, { name: '石家莊 (Shijiazhuang)' }, { name: '太原 (Taiyuan)' }, { name: '呼和浩特 (Hohhot)' }] },
          { name: '華東 (East China)', children: [{ name: '上海 (Shanghai)' }, { name: '南京 (Nanjing)' }, { name: '杭州 (Hangzhou)' }, { name: '合肥 (Hefei)' }, { name: '福州 (Fuzhou)' }, { name: '南昌 (Nanchang)' }, { name: '濟南 (Jinan)' }] },
          { name: '華中 (Central China)', children: [{ name: '武漢 (Wuhan)' }, { name: '鄭州 (Zhengzhou)' }, { name: '長沙 (Changsha)' }] },
          { name: '華南 (South China)', children: [{ name: '廣州 (Guangzhou)' }, { name: '深圳 (Shenzhen)' }, { name: '南寧 (Nanning)' }, { name: '海口 (Haikou)' }] },
          { name: '西南 (Southwest China)', children: [{ name: '重慶 (Chongqing)' }, { name: '成都 (Chengdu)' }, { name: '貴陽 (Guiyang)' }, { name: '昆明 (Kunming)' }] },
          { name: '西北 (Northwest China)', children: [{ name: '西安 (Xi\'an)' }, { name: '蘭州 (Lanzhou)' }, { name: '烏魯木齊 (Urumqi)' }] },
          { name: '東北 (Northeast China)', children: [{ name: '瀋陽 (Shenyang)' }, { name: '長春 (Changchun)' }, { name: '哈爾濱 (Harbin)' }] }
        ] 
      },
      { 
        name: '日本 (Japan)', 
        children: [
          { name: '東京都 (Tokyo)', children: [{ name: '東京特別區 (Tokyo Wards)' }, { name: '八王子市 (Hachioji)' }, { name: '町田市 (Machida)' }] },
          { name: '大阪府 (Osaka)', children: [{ name: '大阪市 (Osaka City)' }, { name: '堺市 (Sakai)' }, { name: '東大阪市 (Higashiosaka)' }] },
          { name: '京都府 (Kyoto)', children: [{ name: '京都市 (Kyoto City)' }, { name: '宇治市 (Uji)' }] },
          { name: '北海道 (Hokkaido)', children: [{ name: '札幌市 (Sapporo)' }, { name: '函館市 (Hakodate)' }, { name: '旭川市 (Asahikawa)' }] },
          { name: '愛知縣 (Aichi)', children: [{ name: '名古屋市 (Nagoya)' }, { name: '豐田市 (Toyota)' }, { name: '岡崎市 (Okazaki)' }] },
          { name: '福岡縣 (Fukuoka)', children: [{ name: '福岡市 (Fukuoka City)' }, { name: '北九州市 (Kitakyushu)' }, { name: '久留米市 (Kurume)' }] },
          { name: '神奈川縣 (Kanagawa)', children: [{ name: '橫濱市 (Yokohama)' }, { name: '川崎市 (Kawasaki)' }, { name: '相模原市 (Sagamihara)' }] },
          { name: '兵庫縣 (Hyogo)', children: [{ name: '神戶市 (Kobe)' }, { name: '姬路市 (Himeji)' }, { name: '西宮市 (Nishinomiya)' }] },
          { name: '宮城縣 (Miyagi)', children: [{ name: '仙台市 (Sendai)' }] },
          { name: '廣島縣 (Hiroshima)', children: [{ name: '廣島市 (Hiroshima City)' }] }
        ] 
      },
      { name: '韓國 (South Korea)', children: [{ name: '首爾 (Seoul)' }] },
      { name: '新加坡 (Singapore)' },
      { 
        name: '越南 (Vietnam)', 
        children: [
          { name: '北越 (North Vietnam)' }, 
          { name: '中越 (Central Vietnam)' }, 
          { name: '南越 (South Vietnam)' }
        ] 
      },
      { name: '泰國 (Thailand)' }
    ]
  },
  {
    name: '美洲 (Americas)',
    children: [
      { 
        name: '美國 (USA)', 
        children: [
          { name: '紐約 (New York)' },
          { name: '洛杉磯 (Los Angeles)' },
          { name: '芝加哥 (Chicago)' },
          { name: '休士頓 (Houston)' },
          { name: '鳳凰城 (Phoenix)' },
          { name: '費城 (Philadelphia)' },
          { name: '聖安東尼奧 (San Antonio)' },
          { name: '聖地牙哥 (San Diego)' },
          { name: '達拉斯 (Dallas)' },
          { name: '聖荷西 (San Jose)' },
          { name: '奧斯汀 (Austin)' },
          { name: '傑克遜維爾 (Jacksonville)' },
          { name: '舊金山 (San Francisco)' },
          { name: '哥倫布 (Columbus)' },
          { name: '西雅圖 (Seattle)' }
        ] 
      },
      { name: '加拿大 (Canada)', children: [{ name: '多倫多 (Toronto)' }, { name: '溫哥華 (Vancouver)' }] },
      { name: '阿根廷 (Argentina)', children: [{ name: '布宜諾斯艾利斯 (Buenos Aires)' }, { name: '科爾多瓦 (Córdoba)' }, { name: '聖大非 (Santa Fe)' }, { name: '門多薩 (Mendoza)' }] },
      { name: '巴西 (Brazil)', children: [{ name: '聖保羅 (São Paulo)' }, { name: '里約熱內盧 (Rio de Janeiro)' }, { name: '米納斯吉拉斯 (Minas Gerais)' }, { name: '巴伊亞 (Bahia)' }] },
      { name: '墨西哥 (Mexico)', children: [{ name: '墨西哥城 (Mexico City)' }, { name: '哈利斯科 (Jalisco)' }, { name: '新萊昂 (Nuevo León)' }, { name: '普埃布拉 (Puebla)' }] },
      { name: '智利 (Chile)', children: [{ name: '聖地牙哥首都大區 (Santiago Metropolitan)' }, { name: '瓦爾帕萊索 (Valparaíso)' }, { name: '比奧比奧 (Biobío)' }] }
    ]
  },
  {
    name: '歐洲 (Europe)',
    children: [
      { name: '英國 (UK)', children: [{ name: '倫敦 (London)' }, { name: '劍橋 (Cambridge)' }] },
      { name: '德國 (Germany)', children: [{ name: '柏林 (Berlin)' }, { name: '慕尼黑 (Munich)' }] },
      { name: '法國 (France)', children: [{ name: '巴黎 (Paris)' }] },
      { name: '瑞士 (Switzerland)', children: [{ name: '蘇黎世州 (Zurich)' }, { name: '日內瓦州 (Geneva)' }, { name: '沃州 (Vaud)' }, { name: '伯恩州 (Bern)' }] },
      { name: '荷蘭 (Netherlands)', children: [{ name: '北荷蘭省 (North Holland)' }, { name: '南荷蘭省 (South Holland)' }, { name: '烏特勒支省 (Utrecht)' }, { name: '北布拉邦省 (North Brabant)' }] },
      { name: '西班牙 (Spain)', children: [{ name: '馬德里 (Madrid)' }, { name: '加泰隆尼亞 (Catalonia)' }, { name: '安達魯西亞 (Andalusia)' }, { name: '瓦倫西亞 (Valencia)' }] },
      { name: '丹麥 (Denmark)', children: [{ name: '首都大區 (Capital Region)' }, { name: '中日德蘭大區 (Central Denmark)' }, { name: '南丹麥大區 (Southern Denmark)' }] },
      { name: '瑞典 (Sweden)', children: [{ name: '斯德哥爾摩省 (Stockholm)' }, { name: '西約塔蘭省 (Västra Götaland)' }, { name: '斯科訥省 (Skåne)' }] },
      { name: '芬蘭 (Finland)', children: [{ name: '新地 (Uusimaa)' }, { name: '皮爾卡區 (Pirkanmaa)' }, { name: '西南芬蘭區 (Southwest Finland)' }] }
    ]
  }
];

function TreeNode({ node, selected, toggleSelection }: { key?: React.Key, node: any, selected: Set<string>, toggleSelection: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selected.has(node.name);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="ml-4 mt-1">
      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors">
        {hasChildren ? (
          <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button 
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => toggleSelection(node.name)}
        >
          {isSelected ? <CheckSquare size={14} className="text-blue-600 dark:text-blue-400" /> : <Square size={14} className="text-slate-400 dark:text-slate-500" />}
          <span>{node.name}</span>
        </button>
      </div>
      {expanded && hasChildren && (
        <div className="border-l border-slate-200 dark:border-slate-800 ml-2 transition-colors">
          {node.children.map((child: any) => (
            <TreeNode key={child.name} node={child} selected={selected} toggleSelection={toggleSelection} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('acia_isDarkMode');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });
  const [startDate, setStartDate] = useState(() => localStorage.getItem('acia_startDate') || '');
  const [endDate, setEndDate] = useState(() => localStorage.getItem('acia_endDate') || '');
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('acia_locations');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      return new Set();
    }
  });
  const [field, setField] = useState(() => localStorage.getItem('acia_field') || '');
  
  const [isSearching, setIsSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [results, setResults] = useState<Conference[]>(() => {
    try {
      const saved = localStorage.getItem('acia_results');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [expandedFields, setExpandedFields] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('acia_expandedFields');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [error, setError] = useState('');

  // Mock geocoding - in a real app, this would be a proper service
  const geocodeLocation = (location: string) => {
    // Simple mock mapping based on location name
    const locations: Record<string, [number, number]> = {
      '台北': [25.033, 121.565],
      '上海': [31.230, 121.473],
      '東京': [35.676, 139.650],
      '紐約': [40.712, -74.006],
      '倫敦': [51.507, -0.127],
    };
    for (const key in locations) {
      if (location.includes(key)) return locations[key];
    }
    return [0, 0]; // Default
  };

  const resultsWithCoords = useMemo(() => {
    return results.map(c => {
      const [lat, lng] = geocodeLocation(c.location);
      return { ...c, lat, lng };
    });
  }, [results]);

  const [user, setUser] = useState<User | null>(null);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subEmail, setSubEmail] = useState('');
  const [subFrequency, setSubFrequency] = useState('weekly');
  const [subSendTime, setSubSendTime] = useState('08:00');
  const [subEndDate, setSubEndDate] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [mySubscriptions, setMySubscriptions] = useState<any[]>([]);
  const [isLoadingSubs, setIsLoadingSubs] = useState(false);
  const [toastMessage, setToastMessage] = useState<{message: string, type: 'error' | 'success'} | null>(null);

  const showToast = (message: string, type: 'error' | 'success' = 'error') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  useEffect(() => {
    if (showSubscribeModal && user) {
      const fetchSubs = async () => {
        setIsLoadingSubs(true);
        try {
          const q = query(collection(db, 'subscriptions'), where('userId', '==', user.uid));
          const snapshot = await getDocs(q);
          setMySubscriptions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoadingSubs(false);
        }
      };
      fetchSubs();
    }
  }, [showSubscribeModal, user]);

  const handleDeleteSub = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'subscriptions', id));
      setMySubscriptions(prev => prev.filter(s => s.id !== id));
      showToast('刪除成功', 'success');
    } catch (e) {
      console.error(e);
      showToast('刪除失敗');
    }
  };

  const [testingSubId, setTestingSubId] = useState<string | null>(null);
  const handleTestSub = async (subId: string) => {
    const sub = mySubscriptions.find(s => s.id === subId);
    if (!sub) return;

    setTestingSubId(subId);
    try {
      const response = await fetch('/api/subscriptions/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId, subData: sub })
      });
      
      const result = await response.json();
      if (response.ok) {
        if (result.success) {
          showToast(`測試成功！找到 ${result.resultsCount} 筆結果並已發送郵件。`, 'success');
        } else {
          showToast(`測試失敗: ${result.error}`, 'error');
        }
      } else {
        showToast(`測試失敗: ${result.error || '伺服器錯誤'}`, 'error');
      }
    } catch (err: any) {
      showToast('測試請求失敗: ' + err.message);
    } finally {
      setTestingSubId(null);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser && currentUser.email) {
        setSubEmail(currentUser.email);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem('acia_isDarkMode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('acia_startDate', startDate);
  }, [startDate]);

  useEffect(() => {
    localStorage.setItem('acia_endDate', endDate);
  }, [endDate]);

  useEffect(() => {
    localStorage.setItem('acia_locations', JSON.stringify(Array.from(selectedLocations)));
  }, [selectedLocations]);

  useEffect(() => {
    localStorage.setItem('acia_field', field);
  }, [field]);

  useEffect(() => {
    localStorage.setItem('acia_results', JSON.stringify(results));
  }, [results]);

  useEffect(() => {
    localStorage.setItem('acia_expandedFields', JSON.stringify(expandedFields));
  }, [expandedFields]);

  const handleSubscribe = async () => {
    if (!user) {
      showToast('請先登入');
      return;
    }
    if (!startDate || !endDate || !field || selectedLocations.size === 0) {
      showToast('請先在左側填寫完整的篩選參數');
      return;
    }
    
    const emailList = subEmail.split(',').map(e => e.trim()).filter(e => e);
    if (emailList.length === 0) {
      showToast('請填寫收件信箱');
      return;
    }

    setIsSubscribing(true);
    try {
      await addDoc(collection(db, 'subscriptions'), {
        userId: user.uid,
        name: `會議訂閱: ${field}`,
        startDate,
        endDate,
        locations: Array.from(selectedLocations),
        field,
        expandedFields,
        emails: emailList,
        frequency: subFrequency,
        sendTime: subSendTime,
        subscriptionEndDate: subEndDate,
        isActive: true,
        createdAt: serverTimestamp()
      });
      showToast('訂閱成功！系統將會定期為您搜尋並發送報告。', 'success');
      
      // Refresh subscriptions list
      const q = query(collection(db, 'subscriptions'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      setMySubscriptions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
      // Don't close modal immediately so they can see it added
    } catch (err: any) {
      console.error('Subscription error:', err);
      showToast('訂閱失敗: ' + err.message);
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: '國際學術會議檢索報告',
          text: `共找到 ${results.length} 筆會議資訊，請查看附件或連結。`,
          url: window.location.href,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      showToast('您的作業系統或瀏覽器不支援原生分享功能');
    }
  };

  const handleExportCSV = () => {
    const headers = ['項次', '會議主題', '徵稿主題（或範圍）', '舉辦時間', '地點', '投稿截止日', '發佈形態', '掠奪性期刊分析', '會議連結網址'];
    const csvContent = [
      headers.join(','),
      ...results.map((r, i) => [
        i + 1,
        `"${r.theme.replace(/"/g, '""')}"`,
        `"${r.topics.replace(/"/g, '""')}"`,
        `"${r.date}"`,
        `"${r.location}"`,
        `"${r.deadline}"`,
        `"${r.presentationType}"`,
        `"${r.predatoryAnalysis.replace(/"/g, '""')}"`,
        `"${r.url}"`
      ].join(','))
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
        link.download = `Search_report_${dateStr}_${timeStr}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    window.print();
  };

  const toggleLocation = (name: string) => {
    const newSelected = new Set(selectedLocations);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedLocations(newSelected);
  };

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (error: any) {
      console.error('Login failed:', error);
      showToast('登入失敗，請確認您的瀏覽器是否阻擋了彈出視窗。錯誤訊息: ' + error.message);
    }
  };

  const reportLink = async (conference: Conference) => {
    if (!user) {
      showToast('請先登入以回報錯誤');
      return;
    }
    try {
      await addDoc(collection(db, 'invalid_links'), {
        url: conference.url,
        theme: conference.theme,
        reportedAt: serverTimestamp(),
        reporterUid: user.uid
      });
      showToast('感謝您的回報，系統已記錄該錯誤網址。', 'success');
    } catch (e) {
      console.error(e);
      showToast('回報失敗');
    }
  };

  const [searchProgress, setSearchProgress] = useState({ total: 0, completed: 0, current: '' });
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const handleSearch = async () => {
    if (!startDate || !endDate || !field || selectedLocations.size === 0) {
      setError('請填寫所有必填欄位 (時間、地點、領域)');
      return;
    }
    
    setError('');
    setIsSearching(true);
    setResults([]);
    setExpandedFields([]);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const actualField = field.toLowerCase() === 'all' ? '全領域 (All Academic Fields)' : field;
      
      // Phase 1: Expand Fields (Map)
      const expandPrompt = `
        Role: 國際學術會議情報鑑識系統
        Task: 針對「${actualField}」領域，推導出 3 到 5 個具體的子領域標籤。
        Output: 純 JSON 陣列格式，例如 ["領域一", "領域二"]。
      `;

      const expandSchema = {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "擴展搜尋的領域文字標籤 (3-5個)"
      };

      let subFields: string[] = [];
      let expandSuccess = false;
      let expandRetry = 0;

      while (expandRetry < 3 && !expandSuccess) {
        try {
          const expandRes = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: expandPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: expandSchema,
              temperature: 0.2
            }
          });

          if (expandRes && expandRes.text) {
            const expandText = expandRes.text;
            try {
              subFields = JSON.parse(expandText);
            } catch (e) {
              const match = expandText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (match) subFields = JSON.parse(match[1]);
              else throw new Error('擴展領域解析失敗');
            }
            expandSuccess = true;
          } else {
            throw new Error('無法取得擴展領域');
          }
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          console.error('Expand error:', err);
          
          if (err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'))) {
            if (err.message.includes('配額已用盡') || err.message.includes('Daily') || err.message.includes('PerDay')) {
              throw new Error('您的每日 AI 使用配額已用盡。請明天再試。');
            }
            await new Promise(r => setTimeout(r, 10000 * (expandRetry + 1)));
          } else {
            await new Promise(r => setTimeout(r, 2000));
          }
          expandRetry++;
          if (expandRetry >= 3) throw err;
        }
      }
      
      setExpandedFields(subFields);
      setSearchProgress({ total: subFields.length, completed: 0, current: '' });

      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Phase 2: Queue-based Search (Reduce)
      const processQueue = async (items: string[], concurrency: number) => {
        const queue = [...items];
        const worker = async () => {
          while (queue.length > 0) {
            const subField = queue.shift();
            if (!subField) continue;
            
            setSearchProgress(prev => ({ ...prev, current: subField }));
            
            const isChinaSelected = Array.from<string>(selectedLocations).some(loc => loc.includes('中國') || loc.includes('China'));
            
            const searchPrompt = `
              Role: 國際學術會議情報鑑識系統
              Objective: 檢索全球會議資訊，並執行掠奪性期刊鑑識。
              Language: 繁體中文
              
              Parameters:
              - 領域: ${subField} (屬於 ${actualField})
              - 時間: ${startDate} ~ ${endDate}
              - 地點: ${Array.from(selectedLocations).join(', ')}

              Instructions:
              1. 嚴格遵守「逆向三步驟」驗證規則：
                 - 第一步（識別）：確認會議名稱、主辦單位及舉辦細節。
                 - 第二步（定位）：尋找該會議的「官方網站」深層網址，優先選擇 .edu, .org 或學術學會網域。
                 - 第三步（驗證）：確保所提供的網址目前可公開訪問，且內容確實包含該會議的徵稿資訊。
              2. 廣泛檢索各大學、研究機構、學會及期刊組織 (如 SSCI, SCI, EI) 的官方訊息。
              ${isChinaSelected ? `特別指示：請強制檢索中國重點大學官網 (site:tsinghua.edu.cn, pku.edu.cn, zju.edu.cn, sjtu.edu.cn, fudan.edu.cn, nju.edu.cn, ustc.edu.cn 等)。` : ''}
              3. 提取確切深層網址，摘錄網頁原文字句以支持論點。
              4. 交叉比對主辦方與收費模式，進行「掠奪性期刊」研判。
              5. 必須回傳 JSON 陣列。
            `;

            const searchSchema = {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  theme: { type: "STRING", description: "會議主題" },
                  topics: { type: "STRING", description: "徵稿主題（或範圍）" },
                  date: { type: "STRING", description: "舉辦時間" },
                  location: { type: "STRING", description: "地點" },
                  deadline: { type: "STRING", description: "投稿截止日" },
                  presentationType: { type: "STRING", description: "發佈形態 (口頭 / 海報 / 其他)" },
                  predatoryAnalysis: { type: "STRING", description: "掠奪性期刊分析 (含鑑識說明)" },
                  url: { type: "STRING", description: "會議官方網站完整 URL（必須從 Google Search 搜尋結果中直接複製，不得自行組合或推測）" },
                  originalTextQuote: { type: "STRING", description: "支持論點的網頁原文字句" },
                  urlSource: { type: "STRING", description: "找到此 URL 的搜尋來源摘要，例如：搜尋結果標題、搜尋關鍵字、來源網域。若為推測則填入 'inferred'。" }
                },
                required: ["theme", "topics", "date", "location", "deadline", "presentationType", "predatoryAnalysis", "url", "originalTextQuote", "urlSource"]
              }
            };

            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            while (retryCount < maxRetries && !success) {
              try {
                const result = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: searchPrompt,
                  config: {
                    tools: [{ googleSearch: {} }],
                    responseMimeType: 'application/json',
                    responseSchema: searchSchema,
                    temperature: 0.2
                  }
                });
                
                if (result && result.text) {
                  const text = result.text;
                  let data: any = [];
                  try {
                    data = JSON.parse(text);
                  } catch (e) {
                    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                    if (match) data = JSON.parse(match[1]);
                  }
                  
                  const validData = Array.isArray(data) ? data : (data.conferences || []);
                  const processedData = validData.map((c: any) => ({ ...c, urlStatus: 'pending' as const }));
                  
                  if (processedData.length > 0) {
                    setResults(prev => {
                      const newResults = [...prev, ...processedData];
                      return Array.from(new Map(newResults.map(item => [item.theme, item])).values());
                    });
                    verifyLinks(processedData);
                  }
                  success = true;
                } else {
                  throw new Error(`API returned empty result`);
                }
              } catch (err: any) {
                if (err.name === 'AbortError') return;
                console.error(`Search failed for ${subField}:`, err);
                
                if (err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'))) {
                  if (err.message.includes('配額已用盡') || err.message.includes('Daily') || err.message.includes('PerDay')) {
                    throw new Error('您的每日 AI 使用配額已用盡。請明天再試。');
                  }
                  
                  let waitTime = 30000 * Math.pow(2, retryCount);
                  const match = err.message.match(/retry in ([\d.]+)s/);
                  if (match) waitTime = parseFloat(match[1]) * 1000 + 1000;
                  
                  console.warn(`Quota exceeded for ${subField}. Retrying in ${waitTime/1000}s...`);
                  setSearchProgress(prev => ({ ...prev, current: `配額用盡，等待 ${Math.round(waitTime/1000)} 秒後重試...` }));
                  await sleep(waitTime);
                  retryCount++;
                } else {
                  retryCount++;
                  await sleep(5000 * retryCount);
                }
              }
            }
            
            setSearchProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
            // Add a larger delay between requests to stay within free tier limits
            await sleep(3000);
          }
        };

        await Promise.all(Array(Math.min(concurrency, items.length)).fill(null).map(worker));
      };

      await processQueue(subFields, 1); // Use concurrency 1 for free tier

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Search aborted');
      } else {
        setError(err.message);
      }
    } finally {
      setIsSearching(false);
      setAbortController(null);
    }
  };

  const handleAbort = () => {
    if (abortController) {
      abortController.abort();
      setIsSearching(false);
      setAbortController(null);
      showToast('搜尋已終止', 'success');
    }
  };

  // verifyLinks: 僅依賴後端 HTTP 驗證，不再使用無搜尋工具的 AI 猜測
  const verifyLinks = async (conferences: Conference[]) => {
    const urls = conferences.map(c => c.url);
    try {
      const response = await fetch('/api/utils/verify-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });
      
      if (response.ok) {
        const resultsMap = await response.json();
        for (const c of conferences) {
          const isReachable = resultsMap[c.url];
          if (isReachable) {
            // HTTP 可連通 → 標記為有效，不再用 AI 猜內容
            setResults(prev => prev.map(item =>
              item.theme === c.theme ? { ...item, urlStatus: 'valid' as const } : item
            ));
          } else {
            // HTTP 不可連通 → 標記 fixing 狀態後執行自動修復
            setResults(prev => prev.map(item =>
              item.theme === c.theme ? { ...item, urlStatus: 'fixing' as const } : item
            ));
            fixLink(c);
          }
        }
      } else {
        // 後端驗證服務不可用時，統一標記為 pending（保留連結可點擊）
        console.warn('verify-links service unavailable, skipping validation');
        setResults(prev => prev.map(item =>
          conferences.some(c => c.theme === item.theme)
            ? { ...item, urlStatus: 'pending' as const }
            : item
        ));
      }
    } catch (e) {
      console.error('Link verification failed', e);
    }
  };

  // fixLink: 使用 Google Search 工具尋找正確 URL，修復後重新做後端 HTTP 驗證
  const fixLink = async (conference: Conference) => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    let retryCount = 0;

    while (retryCount < 3) {
      try {
        const prompt = `You are an academic conference URL locator. The URL "${conference.url}" for the conference "${conference.theme}" is unreachable. Use Google Search to find the current official website. Return ONLY the raw URL string, no markdown, no explanation.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1
          }
        });

        if (response && response.text) {
          // 從回應中提取 URL（過濾 markdown 格式殘留）
          const rawText = response.text.trim();
          const urlMatch = rawText.match(/https?:\/\/[^\s"'<>)]+/);
          const newUrl = urlMatch ? urlMatch[0] : null;

          if (newUrl && newUrl !== conference.url) {
            // 修復後重新做後端 HTTP 驗證，避免 AI 仍然回傳錯誤 URL
            try {
              const verifyRes = await fetch('/api/utils/verify-links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: [newUrl] })
              });
              if (verifyRes.ok) {
                const verifyMap = await verifyRes.json();
                const isNewUrlValid = verifyMap[newUrl];
                setResults(prev => prev.map(c =>
                  c.theme === conference.theme
                    ? { ...c, url: isNewUrlValid ? newUrl : c.url, urlStatus: isNewUrlValid ? 'valid' as const : 'invalid' as const }
                    : c
                ));
                return;
              }
            } catch (_verifyErr) {
              // 後端驗證失敗時，仍套用新 URL 但維持 pending 狀態
              setResults(prev => prev.map(c =>
                c.theme === conference.theme ? { ...c, url: newUrl, urlStatus: 'pending' as const } : c
              ));
              return;
            }
          } else {
            // AI 沒有找到不同的 URL
            break;
          }
        } else {
          break;
        }
      } catch (e: any) {
        if (e.message && (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED'))) {
          const waitTime = Math.pow(2, retryCount) * 15000;
          console.warn(`fixLink quota exceeded. Retrying in ${waitTime / 1000}s...`);
          await sleep(waitTime);
          retryCount++;
        } else {
          retryCount++;
          await sleep(3000 * retryCount);
        }
      }
    }

    // 三次重試失敗 → 確認為無效，不保留虛構連結
    setResults(prev => prev.map(c =>
      c.theme === conference.theme ? { ...c, urlStatus: 'invalid' as const } : c
    ));
  };

  const formatError = (err: string) => {
    if (!err) return '';
    try {
      const parsed = JSON.parse(err);
      let message = err;
      
      if (parsed.error) {
        if (typeof parsed.error === 'string') {
          try {
            const inner = JSON.parse(parsed.error);
            if (inner.error && inner.error.message) {
              message = inner.error.message;
            }
          } catch (e) {
            message = parsed.error;
          }
        } else if (parsed.error.message) {
          message = parsed.error.message;
        }
      }
      
      if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
        return 'AI 服務目前繁忙或配額用盡。系統正在嘗試自動重試，請稍候。如果持續出現此訊息，可能是因為每日免費配額已達上限，請明天再試。';
      }
      return message;
    } catch (e) {
      if (err.includes('quota') || err.includes('RESOURCE_EXHAUSTED')) {
        return 'AI 服務目前繁忙或配額用盡。請稍後再試，或嘗試縮小搜尋範圍。';
      }
      return err;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans selection:bg-blue-500/30 transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10 no-print">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Globe className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-medium text-slate-900 dark:text-white tracking-wide">國際學術會議搜尋系統</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Academic Conference Intelligence Agent v1.0</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-400 hidden sm:inline-block">{user.email}</span>
                <button onClick={logout} className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-slate-500 hover:text-red-500" title="登出">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button onClick={handleLogin} className="text-xs font-medium px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors">
                登入以訂閱
              </button>
            )}
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)} 
              className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title={isDarkMode ? "切換至淺色模式" : "切換至深色模式"}
            >
              {isDarkMode ? <Sun size={20} className="text-slate-400 hover:text-amber-400"/> : <Moon size={20} className="text-slate-500 hover:text-blue-600"/>}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8">
        {/* Sidebar Filters */}
        <aside className="w-full lg:w-80 flex-shrink-0 space-y-6 no-print">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xl transition-colors">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Search size={16} className="text-blue-400" />
              篩選參數
            </h2>
            
            <div className="space-y-5">
              {/* Time Range */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Calendar size={14} /> 舉辦時間區間
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors dark:[&::-webkit-calendar-picker-indicator]:invert-[0.8]"
                  />
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors dark:[&::-webkit-calendar-picker-indicator]:invert-[0.8]"
                  />
                </div>
              </div>

              {/* Field of Study */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <BookOpen size={14} /> 專業領域 (AI 動態擴展)
                </label>
                <input 
                  type="text" 
                  placeholder="例如：人工智慧、材料科學、生醫工程..."
                  value={field}
                  onChange={e => setField(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>

              {/* Location Tree */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <MapPin size={14} /> 舉辦地點
                </label>

                {/* Selected Location Tags */}
                {selectedLocations.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Array.from<string>(selectedLocations).map(loc => (
                      <span key={loc} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] rounded border border-blue-200 dark:border-blue-800/50">
                        {loc}
                        <button 
                          onClick={() => toggleLocation(loc)}
                          className="hover:text-red-500 transition-colors p-0.5 rounded-sm hover:bg-blue-200 dark:hover:bg-blue-800/50"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 max-h-60 overflow-y-auto custom-scrollbar">
                  <div className="-ml-4">
                    {LOCATIONS.map(loc => (
                      <TreeNode key={loc.name} node={loc} selected={selectedLocations} toggleSelection={toggleLocation} />
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={handleSearch}
                disabled={isSearching}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20"
              >
                {isSearching ? (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-xs text-blue-200">
                      <span>檢索中: {searchProgress.current || '初始化...'}</span>
                      <span>{Math.round((searchProgress.completed / searchProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-blue-800 rounded-full h-1.5">
                      <div className="bg-blue-400 h-1.5 rounded-full transition-all duration-300" style={{ width: `${(searchProgress.completed / searchProgress.total) * 100}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <><Search size={18} /> 開始檢索</>
                )}
              </button>

              {isSearching && (
                <button 
                  onClick={handleAbort}
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                >
                  <X size={18} /> 終止搜尋
                </button>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex flex-col gap-2 text-red-500 dark:text-red-400 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <p className="font-medium">發生錯誤</p>
                  </div>
                  <p className="text-xs opacity-90 leading-relaxed">{formatError(error)}</p>
                  {error.includes('配額') && (
                    <div className="mt-1 p-2 bg-red-500/5 rounded border border-red-500/10 text-[10px]">
                      提示：免費版 API 有每日使用量限制。建議縮小搜尋範圍以節省配額。
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <button 
                  onClick={() => user ? setShowSubscribeModal(true) : handleLogin()}
                  className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <BellRing size={18} />
                  {user ? '訂閱自動搜尋' : '登入以訂閱自動搜尋'}
                </button>
                <p className="text-[10px] text-slate-500 text-center mt-2">
                  系統將依據上方參數定期搜尋並寄送報告
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 print-expand flex flex-col gap-4">
          
          {/* Expanded Fields Tags */}
          {!isSearching && expandedFields.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-3">
                <Search size={16} className="text-indigo-500" />
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">AI 擴展搜尋領域</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {expandedFields.map((fieldTag, idx) => (
                  <span key={idx} className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800/50 rounded-full text-xs font-medium shadow-sm">
                    {fieldTag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden flex flex-col h-[calc(100vh-12rem)] min-h-[500px] transition-colors">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80 flex-wrap gap-4 sticky top-0 z-10 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-500 dark:text-emerald-400" />
                  檢索報告
                </h2>
                <div className="text-xs text-slate-500 font-mono">
                  {results.length > 0 ? `共 ${results.length} 筆結果` : '等待檢索指令'}
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                  <button 
                    onClick={() => setViewMode('list')}
                    className={cn("p-1.5 rounded-md transition-colors", viewMode === 'list' ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                  >
                    <List size={16} />
                  </button>
                  <button 
                    onClick={() => setViewMode('map')}
                    className={cn("p-1.5 rounded-md transition-colors", viewMode === 'map' ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                  >
                    <MapIcon size={16} />
                  </button>
                </div>

                {results.length > 0 && (
                  <div className="flex items-center gap-2 no-print">
                    <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors">
                      <Share2 size={14} /> 分享
                    </button>
                    <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors">
                      <Download size={14} /> 匯出 CSV
                    </button>
                    <button onClick={handleExportPDF} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors">
                      <Printer size={14} /> 列印 / PDF
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
              {results.length === 0 && !isSearching ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 p-8">
                  <Globe size={48} className="opacity-20" />
                  <p className="text-sm">請設定左側參數並點擊「開始檢索」</p>
                </div>
              ) : isSearching ? (
                <div className="h-full flex flex-col items-center justify-center text-blue-400 space-y-4 p-8">
                  <Loader2 size={48} className="animate-spin opacity-50" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium">正在執行廣泛網路檢索...</p>
                    <p className="text-xs text-slate-500 font-mono">Executing Step 1: Scope & Step 2: Verify</p>
                  </div>
                </div>
              ) : viewMode === 'map' ? (
                <div className="h-[500px] w-full">
                  <MapContainer center={[25, 121]} zoom={2} className="h-full w-full">
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {resultsWithCoords.map((conf, idx) => (
                      conf.lat !== 0 && conf.lng !== 0 && (
                        <Marker key={idx} position={[conf.lat!, conf.lng!]}>
                          <Popup>
                            <div className="text-sm">
                              <p className="font-bold">{conf.theme}</p>
                              <p>{conf.location}</p>
                              <a href={conf.url} target="_blank" rel="noreferrer" className="text-blue-500 underline">查看詳情</a>
                            </div>
                          </Popup>
                        </Marker>
                      )
                    ))}
                  </MapContainer>
                </div>
              ) : (
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-100/50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-medium">項次</th>
                      <th className="px-4 py-3 font-medium">會議主題</th>
                      <th className="px-4 py-3 font-medium">徵稿主題（或範圍）</th>
                      <th className="px-4 py-3 font-medium">舉辦時間/地點</th>
                      <th className="px-4 py-3 font-medium">投稿截止/發佈形態</th>
                      <th className="px-4 py-3 font-medium">掠奪性期刊分析</th>
                      <th className="px-4 py-3 font-medium">會議連結網址</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50">
                    {results.map((conf, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors group">
                        <td className="px-4 py-4 text-slate-500 font-mono">{String(idx + 1).padStart(2, '0')}</td>
                        <td className="px-4 py-4 whitespace-normal min-w-[200px]">
                          <div className="font-medium text-slate-900 dark:text-slate-200">{conf.theme}</div>
                        </td>
                        <td className="px-4 py-4 whitespace-normal min-w-[200px]">
                          <div className="text-sm text-slate-600 dark:text-slate-400">{conf.topics}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-slate-700 dark:text-slate-300">{conf.date}</div>
                          <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                            <MapPin size={12} /> {conf.location}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-slate-700 dark:text-slate-300">{conf.deadline}</div>
                          <div className="text-xs text-slate-500 mt-1">{conf.presentationType}</div>
                        </td>
                        <td className="px-4 py-4 whitespace-normal min-w-[250px]">
                          <div className="flex items-start gap-2 text-xs">
                            {conf.predatoryAnalysis.includes('高風險') || conf.predatoryAnalysis.includes('掠奪性') ? (
                              <ShieldAlert size={14} className="text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                            ) : (
                              <ShieldCheck size={14} className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                            )}
                            <span className="text-slate-600 dark:text-slate-400 leading-relaxed">{conf.predatoryAnalysis}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-normal min-w-[250px]">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {conf.urlStatus === 'pending' && <Loader2 size={14} className="text-slate-500 animate-spin" />}
                              {conf.urlStatus === 'valid' && <CheckSquare size={14} className="text-emerald-500 dark:text-emerald-400" />}
                              {conf.urlStatus === 'invalid' && <AlertTriangle size={14} className="text-red-500 dark:text-red-400" />}
                              {conf.urlStatus === 'fixing' && <RefreshCw size={14} className="text-amber-500 dark:text-amber-400 animate-spin" />}

                              {conf.urlStatus === 'invalid' ? (
                                // invalid 狀態：不渲染可點擊連結，避免使用者點到虛假 URL
                                <span className="text-xs text-red-500 dark:text-red-400 font-medium">
                                  無法確認官方連結
                                </span>
                              ) : (
                                <a href={conf.url} target="_blank" rel="noreferrer" className={cn(
                                  "text-xs font-mono truncate max-w-[200px] hover:underline flex items-center gap-1",
                                  conf.urlStatus === 'valid' ? "text-blue-600 dark:text-blue-400" :
                                  conf.urlStatus === 'fixing' ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"
                                )}>
                                  <LinkIcon size={12} />
                                  {conf.urlStatus === 'fixing' ? '正在自動修正...' : conf.url}
                                </a>
                              )}

                              <button
                                onClick={() => reportLink(conf)}
                                className="text-[10px] text-slate-400 hover:text-red-500 ml-2 underline"
                              >
                                回報錯誤
                              </button>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-600 font-mono border-l-2 border-slate-300 dark:border-slate-700 pl-2 italic">
                              「{conf.originalTextQuote}」
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #334155;
        }
      `}</style>

      {/* Subscribe Modal */}
      {showSubscribeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <BellRing size={18} className="text-blue-500" />
                設定自動搜尋訂閱
              </h3>
              <button onClick={() => setShowSubscribeModal(false)} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">收件信箱 (預設為您的登入信箱，可輸入多筆，以逗號分隔)</label>
                <input 
                  type="text" 
                  value={subEmail}
                  onChange={e => setSubEmail(e.target.value)}
                  placeholder="example1@gmail.com, example2@gmail.com"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">發送頻率</label>
                <select 
                  value={subFrequency}
                  onChange={e => setSubFrequency(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                >
                  <option value="daily">每天</option>
                  <option value="weekly">每週</option>
                  <option value="monthly">每月</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">自訂發送時間</label>
                <input 
                  type="time" 
                  value={subSendTime}
                  onChange={e => setSubSendTime(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">訂閱結束日期</label>
                <input 
                  type="date" 
                  value={subEndDate}
                  onChange={e => setSubEndDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                  <strong>說明：</strong>設定發送頻率後，系統將於您指定的「發送時間」自動執行搜尋，並將結果發送至您的信箱。訂閱將持續至您設定的「結束日期」為止。
                </p>
              </div>
              
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">我的訂閱紀錄</h4>
                {isLoadingSubs ? (
                  <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
                ) : mySubscriptions.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-2">尚無訂閱紀錄</p>
                ) : (
                  <div className="space-y-2">
                    {mySubscriptions.map(sub => (
                      <div key={sub.id} className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{sub.name}</p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">信箱: {sub.emails?.join(', ')}</p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">地點: {sub.locations?.join(', ')}</p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">AI 擴展搜尋領域: {sub.expandedFields?.join(', ')}</p>
                          <p className="text-xs text-slate-500 mt-0.5">頻率: {sub.frequency === 'daily' ? '每天' : sub.frequency === 'weekly' ? '每週' : '每月'}</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button 
                            onClick={() => handleTestSub(sub.id)}
                            disabled={testingSubId === sub.id}
                            className="text-blue-500 hover:text-blue-600 p-1 rounded transition-colors disabled:opacity-50"
                            title="立即測試發送"
                          >
                            {testingSubId === sub.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          </button>
                          <button 
                            onClick={() => handleDeleteSub(sub.id)}
                            className="text-slate-400 hover:text-red-500 p-1 rounded transition-colors"
                            title="刪除訂閱"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
              <button 
                onClick={() => setShowSubscribeModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                關閉
              </button>
              <button 
                onClick={handleSubscribe}
                disabled={isSubscribing}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubscribing ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />}
                新增訂閱
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className={cn(
          "fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-300",
          toastMessage.type === 'success' ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
        )}>
          {toastMessage.type === 'success' ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          <span className="text-sm font-medium">{toastMessage.message}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 hover:opacity-70">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
