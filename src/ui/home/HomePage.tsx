import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import Markdown from '@/components/Markdown';
import Spinner from '@/components/Spinner';
import { api } from '@/lib/api';
import type {
  ChatMessage,
  ChatSession,
  Discussion,
  DiscussionMessage,
  KnowledgeEdge,
  KnowledgeExtraction,
  KnowledgeGraph,
  KnowledgeNode,
  Persona,
} from '@/lib/api';

const SAMPLE_INPUT =
  '요즘 잠을 5시간밖에 못 자고 오전 수업 집중도가 떨어졌어. 과제 마감이 겹친 날에는 카페인 섭취도 늘었어.';

const DOMAIN_COLORS: Record<string, string> = {
  건강: '#16a34a',
  학업: '#2563eb',
  금융: '#ca8a04',
  취미: '#db2777',
  업무: '#7c3aed',
};

const ROUND_ORDER: DiscussionMessage['round'][] = ['ANALYSIS', 'REBUTTAL', 'SYNTHESIS'];
const ROUND_LABEL: Record<DiscussionMessage['round'], string> = {
  ANALYSIS: '1라운드 · 분석',
  REBUTTAL: '2라운드 · 반론',
  SYNTHESIS: '3라운드 · 종합',
};

type LoadState = 'idle' | 'loading';

type ChatState = {
  session: ChatSession | null;
  messages: ChatMessage[];
};

type GraphPoint = KnowledgeNode & {
  x: number;
  y: number;
  color: string;
};

function HomePage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [inputText, setInputText] = useState(SAMPLE_INPUT);
  const [newDomain, setNewDomain] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [discussionTopic, setDiscussionTopic] = useState('요즘 피곤한 이유를 건강과 학업 관점에서 분석해줘');
  const [chatPersonaId, setChatPersonaId] = useState<number | null>(null);
  const [discussionPersonaIds, setDiscussionPersonaIds] = useState<number[]>([]);
  const [chatStateByPersona, setChatStateByPersona] = useState<Record<number, ChatState>>({});
  const [lastExtraction, setLastExtraction] = useState<KnowledgeExtraction | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState<Record<string, LoadState>>({});

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const activeChatPersona = useMemo(
    () => personas.find((persona) => persona.id === chatPersonaId) ?? null,
    [chatPersonaId, personas],
  );

  const activeChat = chatPersonaId ? chatStateByPersona[chatPersonaId] : undefined;

  const visibleGraph = useMemo(() => {
    if (graph) {
      return { nodes: graph.nodes, edges: graph.edges };
    }

    return { nodes, edges: lastExtraction?.edges ?? [] };
  }, [graph, lastExtraction?.edges, nodes]);

  const graphPoints = useMemo(
    () => positionNodes(visibleGraph.nodes, graph?.centerNode.id ?? selectedNodeId),
    [visibleGraph.nodes, graph?.centerNode.id, selectedNodeId],
  );

  const graphPointById = useMemo(() => {
    return new Map(graphPoints.map((point) => [point.id, point]));
  }, [graphPoints]);

  const setBusy = useCallback((key: string, value: boolean) => {
    setLoading((current) => ({ ...current, [key]: value ? 'loading' : 'idle' }));
  }, []);

  const refreshData = useCallback(async () => {
    setBusy('initial', true);
    setErrorMessage('');

    try {
      const [nextPersonas, nextNodes] = await Promise.all([api.getPersonas(), api.getNodes()]);
      setPersonas(nextPersonas);
      setNodes(nextNodes);

      if (!chatPersonaId && nextPersonas.length > 0) {
        setChatPersonaId(nextPersonas[0].id);
      }

      if (discussionPersonaIds.length === 0 && nextPersonas.length > 0) {
        setDiscussionPersonaIds(nextPersonas.slice(0, 2).map((persona) => persona.id));
      }

      if (!selectedNodeId && nextNodes.length > 0) {
        setSelectedNodeId(nextNodes[0].id);
      }
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusy('initial', false);
    }
  }, [chatPersonaId, discussionPersonaIds.length, selectedNodeId, setBusy]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!selectedNodeId) {
      setGraph(null);
      return;
    }

    let ignore = false;
    setBusy('graph', true);

    api
      .getNodeGraph(selectedNodeId)
      .then((nextGraph) => {
        if (!ignore) {
          setGraph(nextGraph);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setGraph(null);
          setErrorMessage(toMessage(error));
        }
      })
      .finally(() => {
        if (!ignore) {
          setBusy('graph', false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedNodeId, setBusy]);

  const handleExtract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!inputText.trim()) {
      setErrorMessage('분석할 텍스트를 입력해 주세요.');
      return;
    }

    setBusy('extract', true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const extraction = await api.extractKnowledge(inputText.trim());
      const nextNodes = await api.getNodes();
      setLastExtraction(extraction);
      setNodes(nextNodes);
      setSelectedNodeId(extraction.nodes[0]?.id ?? nextNodes[0]?.id ?? null);
      setInputText('');
      setStatusMessage(`노드 ${extraction.nodes.length}개와 연결 ${extraction.edges.length}개를 저장했습니다.`);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusy('extract', false);
    }
  };

  const handleCreatePersona = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!newDomain.trim()) {
      setErrorMessage('생성할 도메인 이름을 입력해 주세요.');
      return;
    }

    setBusy('persona', true);
    setErrorMessage('');

    try {
      const persona = await api.createPersona(newDomain.trim());
      const nextPersonas = await api.getPersonas();
      setPersonas(nextPersonas);
      setNewDomain('');
      setChatPersonaId(persona.id);
      setDiscussionPersonaIds((current) => uniqueIds([...current, persona.id]).slice(0, 4));
      setStatusMessage(`${persona.name} 페르소나를 생성했습니다.`);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusy('persona', false);
    }
  };

  const handleSendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeChatPersona || !chatInput.trim()) {
      setErrorMessage('페르소나와 메시지를 확인해 주세요.');
      return;
    }

    setBusy('chat', true);
    setErrorMessage('');

    const content = chatInput.trim();
    const optimisticMessage: ChatMessage = {
      id: Date.now(),
      sequence: activeChat?.messages.length ?? 0,
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    };

    setChatInput('');
    setChatStateByPersona((current) => ({
      ...current,
      [activeChatPersona.id]: {
        session: current[activeChatPersona.id]?.session ?? null,
        messages: [...(current[activeChatPersona.id]?.messages ?? []), optimisticMessage],
      },
    }));

    try {
      const session =
        activeChat?.session ??
        (await api.createChatSession(activeChatPersona.id, `${activeChatPersona.domainName} 상담`));
      const reply = await api.sendChatMessage(session.id, content);
      const history = await api.getChatMessages(session.id);

      setChatStateByPersona((current) => ({
        ...current,
        [activeChatPersona.id]: {
          session,
          messages: history.length > 0 ? history : [...(current[activeChatPersona.id]?.messages ?? []), reply],
        },
      }));
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusy('chat', false);
    }
  };

  const handleCreateDiscussion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!discussionTopic.trim()) {
      setErrorMessage('토론 주제를 입력해 주세요.');
      return;
    }

    if (discussionPersonaIds.length < 2) {
      setErrorMessage('토론에는 최소 2개의 페르소나가 필요합니다.');
      return;
    }

    setBusy('discussion', true);
    setErrorMessage('');

    try {
      const nextDiscussion = await api.createDiscussion(
        discussionTopic.trim(),
        selectedNodeId,
        discussionPersonaIds,
      );
      setDiscussion(nextDiscussion);
      setStatusMessage('멀티 에이전트 토론이 완료되었습니다.');
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusy('discussion', false);
    }
  };

  const toggleDiscussionPersona = (personaId: number) => {
    setDiscussionPersonaIds((current) =>
      current.includes(personaId)
        ? current.filter((id) => id !== personaId)
        : uniqueIds([...current, personaId]),
    );
  };

  return (
    <div className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI13 Personal Knowledge Graph</p>
          <h1>생활 데이터를 연결하는 AI 지식 그래프</h1>
        </div>
        <button className="ghost-button" onClick={() => void refreshData()} type="button">
          새로고침
        </button>
      </header>

      {(errorMessage || statusMessage) && (
        <section className={`notice ${errorMessage ? 'notice-error' : 'notice-success'}`}>
          {errorMessage || statusMessage}
        </section>
      )}

      <section className="dashboard-grid">
        <article className="panel input-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Smart Input</p>
              <h2>텍스트에서 노드 만들기</h2>
            </div>
            <span className="counter">{nodes.length} nodes</span>
          </div>

          <form className="stack" onSubmit={handleExtract}>
            <textarea
              aria-label="지식 추출 텍스트"
              onChange={(event) => setInputText(event.target.value)}
              placeholder="오늘의 컨디션, 일정, 공부, 소비 패턴을 자유롭게 적어보세요."
              value={inputText}
            />
            <button className="primary-button" disabled={loading.extract === 'loading'} type="submit">
              {loading.extract === 'loading' && <Spinner />}
              {loading.extract === 'loading' ? '분석 중' : '노드 생성'}
            </button>
          </form>

          {lastExtraction?.suggestedDomains.length ? (
            <div className="suggestions">
              <span>추천 도메인</span>
              {lastExtraction.suggestedDomains.map((domain) => (
                <button key={domain} onClick={() => setNewDomain(domain)} type="button">
                  {domain}
                </button>
              ))}
            </div>
          ) : null}
        </article>

        <article className="panel persona-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Personas</p>
              <h2>도메인 에이전트</h2>
            </div>
          </div>

          <form className="inline-form" onSubmit={handleCreatePersona}>
            <input
              aria-label="새 페르소나 도메인"
              onChange={(event) => setNewDomain(event.target.value)}
              placeholder="예: 업무"
              value={newDomain}
            />
            <button disabled={loading.persona === 'loading'} type="submit">
              생성
            </button>
          </form>

          <div className="persona-list">
            {personas.map((persona) => (
              <button
                className={`persona-chip ${chatPersonaId === persona.id ? 'is-active' : ''}`}
                key={persona.id}
                onClick={() => setChatPersonaId(persona.id)}
                type="button"
              >
                <span style={{ backgroundColor: getDomainColor(persona.domainName) }} />
                <strong>{persona.name}</strong>
                <small>{persona.domainName}</small>
              </button>
            ))}
            {!personas.length && <p className="empty">백엔드에 등록된 페르소나가 없습니다.</p>}
          </div>

          {activeChatPersona && (
            <div className="persona-detail">
              <div className="persona-detail-header">
                <span style={{ backgroundColor: getDomainColor(activeChatPersona.domainName) }} />
                <div>
                  <strong>{activeChatPersona.name}</strong>
                  <small>
                    {activeChatPersona.domainName} ·{' '}
                    {activeChatPersona.builtIn ? '기본 페르소나' : '사용자 추가'}
                  </small>
                </div>
              </div>
              <p className="persona-prompt">{activeChatPersona.systemPrompt}</p>
            </div>
          )}
        </article>

        <article className="panel graph-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Graph Canvas</p>
              <h2>1-hop 지식 그래프</h2>
            </div>
            {loading.graph === 'loading' && <span className="counter">loading</span>}
          </div>

          <GraphCanvas
            edges={visibleGraph.edges}
            nodes={graphPoints}
            nodeById={graphPointById}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
        </article>

        <aside className="panel node-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Selected Node</p>
              <h2>{selectedNode?.title ?? '노드 선택'}</h2>
            </div>
          </div>

          {selectedNode ? (
            <div className="node-detail">
              <span style={{ backgroundColor: getDomainColor(selectedNode.domainName) }}>
                {selectedNode.domainName}
              </span>
              <p>{selectedNode.content}</p>
              <dl>
                <div>
                  <dt>유형</dt>
                  <dd>{selectedNode.nodeType}</dd>
                </div>
                <div>
                  <dt>분석</dt>
                  <dd>{selectedNode.analyzed ? '완료' : '대기'}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="empty">생성된 지식 노드가 없습니다.</p>
          )}

          <div className="node-list">
            {nodes.slice(0, 20).map((node) => (
              <button
                className={selectedNodeId === node.id ? 'is-active' : ''}
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                type="button"
              >
                <span>{node.domainName}</span>
                {node.title}
              </button>
            ))}
          </div>
        </aside>

        <article className="panel chat-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Persona Chat</p>
              <h2>{activeChatPersona?.name ?? '페르소나 채팅'}</h2>
            </div>
            <select
              aria-label="채팅 페르소나"
              onChange={(event) => setChatPersonaId(Number(event.target.value))}
              value={chatPersonaId ?? ''}
            >
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.domainName}
                </option>
              ))}
            </select>
          </div>

          <div className="messages">
            {(activeChat?.messages ?? []).map((message) => (
              <div className={`message ${message.role === 'USER' ? 'is-user' : 'is-assistant'}`} key={message.id}>
                <span>{message.role === 'USER' ? '나' : activeChatPersona?.domainName}</span>
                {message.role === 'USER' ? (
                  <p>{message.content}</p>
                ) : (
                  <Markdown>{message.content}</Markdown>
                )}
              </div>
            ))}
            {!activeChat?.messages.length && loading.chat !== 'loading' && (
              <p className="empty">선택한 페르소나에게 현재 노드나 생활 패턴을 질문해 보세요.</p>
            )}
            {loading.chat === 'loading' && (
              <div className="message is-assistant message-pending">
                <span>{activeChatPersona?.domainName}</span>
                <p className="pending-indicator">
                  <Spinner /> 답변 작성 중…
                </p>
              </div>
            )}
          </div>

          <form className="chat-form" onSubmit={handleSendChat}>
            <input
              aria-label="채팅 메시지"
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="요즘 피곤한 이유가 뭘까?"
              value={chatInput}
            />
            <button disabled={!activeChatPersona || loading.chat === 'loading'} type="submit">
              {loading.chat === 'loading' && <Spinner />}
              {loading.chat === 'loading' ? '전송 중' : '전송'}
            </button>
          </form>
        </article>

        <article className="panel discussion-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Multi-Agent Discussion</p>
              <h2>3라운드 토론</h2>
            </div>
          </div>

          <form className="stack" onSubmit={handleCreateDiscussion}>
            <input
              aria-label="토론 주제"
              onChange={(event) => setDiscussionTopic(event.target.value)}
              value={discussionTopic}
            />
            <div className="persona-toggle-list">
              {personas.map((persona) => (
                <label key={persona.id}>
                  <input
                    checked={discussionPersonaIds.includes(persona.id)}
                    onChange={() => toggleDiscussionPersona(persona.id)}
                    type="checkbox"
                  />
                  <span>{persona.domainName}</span>
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={loading.discussion === 'loading'} type="submit">
              {loading.discussion === 'loading' && <Spinner />}
              {loading.discussion === 'loading' ? '토론 중' : '토론 실행'}
            </button>
          </form>

        </article>

        <article className="panel discussion-result-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Discussion Result</p>
              <h2>토론 결과</h2>
            </div>
          </div>

          {loading.discussion === 'loading' ? (
            <div className="loading-placeholder">
              <Spinner size={22} />
              <span>토론 진행 중… 30초~1분 소요됩니다.</span>
            </div>
          ) : discussion ? (
            <div className="discussion-result">
              <div className="discussion-header">
                <h3>{discussion.title}</h3>
                {discussion.summary && (
                  <Markdown className="discussion-summary">{discussion.summary}</Markdown>
                )}
              </div>

              {discussion.actionPlan && (
                <div className="action-plan">
                  <strong>실행 계획</strong>
                  <Markdown>{discussion.actionPlan}</Markdown>
                </div>
              )}

              <div className="discussion-rounds">
                {ROUND_ORDER.map((round) => {
                  const messages = discussion.messages.filter((m) => m.round === round);
                  if (messages.length === 0) return null;
                  return (
                    <details key={round} className="round-group" open>
                      <summary>{ROUND_LABEL[round]}</summary>
                      <DiscussionRound messages={messages} personas={personas} />
                    </details>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="empty">토론을 실행하면 결과가 여기에 표시됩니다.</p>
          )}
        </article>
      </section>
    </div>
  );
}

function GraphCanvas({
  edges,
  nodes,
  nodeById,
  onSelectNode,
  selectedNodeId,
}: {
  edges: KnowledgeEdge[];
  nodes: GraphPoint[];
  nodeById: Map<number, GraphPoint>;
  onSelectNode: (nodeId: number) => void;
  selectedNodeId: number | null;
}) {
  if (!nodes.length) {
    return <div className="graph-canvas empty-canvas">노드가 생성되면 그래프가 표시됩니다.</div>;
  }

  return (
    <div className="graph-canvas">
      <svg
        aria-hidden="true"
        className="edge-layer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {edges.map((edge) => {
          const source = nodeById.get(edge.sourceNodeId);
          const target = nodeById.get(edge.targetNodeId);

          if (!source || !target) {
            return null;
          }

          return (
            <line
              key={edge.id}
              vectorEffect="non-scaling-stroke"
              strokeWidth={Math.max(1, Number(edge.confidence) * 2.2)}
              strokeOpacity={0.35 + Number(edge.confidence) * 0.55}
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            />
          );
        })}
      </svg>

      {nodes.map((node) => (
        <button
          className={`graph-node ${selectedNodeId === node.id ? 'is-active' : ''}`}
          key={node.id}
          onClick={() => onSelectNode(node.id)}
          style={{ left: `${node.x}%`, top: `${node.y}%`, borderColor: node.color }}
          type="button"
        >
          <span style={{ backgroundColor: node.color }} />
          <strong>{node.title}</strong>
          <small>{node.domainName}</small>
        </button>
      ))}
    </div>
  );
}

function positionNodes(nodes: KnowledgeNode[], centerNodeId: number | null): GraphPoint[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ ...nodes[0], x: 50, y: 50, color: getDomainColor(nodes[0].domainName) }];
  }

  const center =
    (centerNodeId != null && nodes.find((node) => node.id === centerNodeId)) || nodes[0];
  const others = nodes.filter((node) => node.id !== center.id);

  const points: GraphPoint[] = [
    { ...center, x: 50, y: 50, color: getDomainColor(center.domainName) },
  ];

  const innerCap = 6;
  const inner = others.slice(0, innerCap);
  const outer = others.slice(innerCap);

  const placeRing = (ring: KnowledgeNode[], radius: number, angleOffset: number) => {
    ring.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(ring.length, 4) - Math.PI / 2 + angleOffset;
      points.push({
        ...node,
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius,
        color: getDomainColor(node.domainName),
      });
    });
  };

  placeRing(inner, 26, 0);
  placeRing(outer, 42, 0.45);

  return points;
}

function getDomainColor(domainName: string) {
  return DOMAIN_COLORS[domainName] ?? '#0f766e';
}

function DiscussionRound({
  messages,
  personas,
}: {
  messages: DiscussionMessage[];
  personas: Persona[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (messages.length === 0) return null;

  const safeIndex = Math.min(activeIndex, messages.length - 1);
  const active = messages[safeIndex];
  const activeDomain = active.personaId
    ? personas.find((p) => p.id === active.personaId)?.domainName ?? null
    : null;

  if (messages.length === 1) {
    return (
      <div
        className="round-panel"
        style={activeDomain ? { borderLeftColor: getDomainColor(activeDomain) } : undefined}
      >
        <span className="round-message-author">{active.personaName ?? '종합 에이전트'}</span>
        <Markdown>{active.content}</Markdown>
      </div>
    );
  }

  return (
    <div className="round-tabs">
      <div className="round-tablist" role="tablist">
        {messages.map((message, index) => {
          const domain = message.personaId
            ? personas.find((p) => p.id === message.personaId)?.domainName ?? null
            : null;
          const isActive = index === safeIndex;
          const shortLabel = domain ?? '종합';
          return (
            <button
              aria-selected={isActive}
              className={`round-tab ${isActive ? 'is-active' : ''}`}
              key={message.id}
              onClick={() => setActiveIndex(index)}
              role="tab"
              style={
                isActive && domain
                  ? { borderBottomColor: getDomainColor(domain), color: getDomainColor(domain) }
                  : undefined
              }
              type="button"
            >
              {shortLabel}
            </button>
          );
        })}
      </div>
      <div
        className="round-panel"
        role="tabpanel"
        style={activeDomain ? { borderLeftColor: getDomainColor(activeDomain) } : undefined}
      >
        <Markdown>{active.content}</Markdown>
      </div>
    </div>
  );
}

function uniqueIds(ids: number[]) {
  return Array.from(new Set(ids));
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
}

export default HomePage;
