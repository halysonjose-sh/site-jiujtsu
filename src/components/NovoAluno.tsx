import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Plus, Trash2 } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { BottomSheet } from './BottomSheet'
import { useToast } from './Toast'
import {
  aulasDoTexto,
  normalizaEmail,
  rotuloAulas,
  rotuloBotao,
  validaAluno,
  validaLote,
  type AlunoNovo,
} from '../domain/alunos'
import { avatarPath, friendlyError, removeAvatar, type Call } from '../lib/api'
import { compressImage } from '../lib/image'

type Linha = {
  id: string
  nome: string
  email: string
  aulas: string
  foto: File | null
  previa: string | null
}

const linhaVazia = (): Linha => ({
  id: crypto.randomUUID(),
  nome: '',
  email: '',
  aulas: '0',
  foto: null,
  previa: null,
})

/**
 * Folha: o professor cadastra alunos direto no aplicativo (nome, foto, e-mail e
 * quantas aulas ele já fez). O aluno entra na equipe como qualquer outro — dá
 * presença, é graduado — mas ainda não tem login: o e-mail informado é o que
 * permite que ele entre no app depois, se quiser.
 *
 * Vários alunos de uma vez: o professor monta a lista e tudo é gravado numa
 * transação só (ou não é gravado nada).
 */
export function NovoAluno({
  call,
  teamId,
  uploadAvatar,
  onClose,
  onCriado,
}: {
  call: Call
  teamId: string
  uploadAvatar: (path: string, file: Blob) => Promise<void>
  onClose: () => void
  onCriado: () => void | Promise<void>
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [atual, setAtual] = useState<Linha>(linhaVazia)
  const [erro, setErro] = useState('')
  const [pending, setPending] = useState(false)
  const toast = useToast()
  const previa = useRef<string | null>(null)

  // A prévia da foto é uma URL temporária: o app não guarda arquivo do aluno.
  useEffect(() => {
    previa.current = atual.previa
    return () => {
      if (previa.current) URL.revokeObjectURL(previa.current)
    }
  }, [atual.previa])
  useEffect(
    () => () => {
      for (const l of linhas) if (l.previa) URL.revokeObjectURL(l.previa)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function escolherFoto(file: File | null) {
    if (!file) {
      setAtual((a) => ({ ...a, foto: null, previa: null }))
      return
    }
    if (atual.previa) URL.revokeObjectURL(atual.previa)
    setAtual((a) => ({ ...a, foto: file, previa: URL.createObjectURL(file) }))
  }

  /** O que o professor escreveu agora vira mais um aluno da lista. */
  function adicionar(e?: FormEvent) {
    e?.preventDefault()
    const erro = validaAluno({
      nome: atual.nome,
      email: atual.email,
      aulas: aulasDoTexto(atual.aulas),
    })
    if (erro) {
      setErro(erro)
      return
    }
    setErro('')
    setLinhas((l) => [...l, atual])
    setAtual(linhaVazia())
  }

  function remover(id: string) {
    setLinhas((l) => {
      const alvo = l.find((x) => x.id === id)
      if (alvo?.previa) URL.revokeObjectURL(alvo.previa)
      return l.filter((x) => x.id !== id)
    })
  }

  async function criar() {
    if (pending) return
    // O que está no formulário entra junto com o que já está na lista.
    const preenchido = atual.nome.trim().length > 0
    const lista = preenchido ? [...linhas, atual] : linhas
    if (!lista.length) {
      setErro('Informe o nome do aluno.')
      return
    }
    const erro = validaLote(
      lista.map((l) => ({
        id: l.id,
        nome: l.nome,
        email: normalizaEmail(l.email),
        aulas: aulasDoTexto(l.aulas),
      })),
    )
    if (erro) {
      setErro(erro)
      return
    }
    setErro('')
    setPending(true)
    const enviados: string[] = []
    try {
      // As chaves seguem o que a função create_students espera.
      const itens: {
        id: string
        name: string
        email: string
        initialTotal: number
        avatarPath: string | null
      }[] = []
      for (const l of lista) {
        let caminho: string | null = null
        if (l.foto) {
          const blob = await compressImage(l.foto)
          caminho = avatarPath(teamId, l.id, blob)
          await uploadAvatar(caminho, blob)
          enviados.push(caminho)
        }
        itens.push({
          id: l.id,
          name: l.nome.trim(),
          email: normalizaEmail(l.email),
          initialTotal: aulasDoTexto(l.aulas),
          avatarPath: caminho,
        })
      }
      await call('create_students', { p_students: itens })
      toast.show(
        itens.length === 1
          ? 'Aluno criado. Ele já aparece na lista da equipe.'
          : `${itens.length} alunos criados. Eles já aparecem na lista da equipe.`,
      )
      await onCriado()
      onClose()
    } catch (err) {
      // O banco recusou o lote: as fotos enviadas não podem ficar órfãs.
      for (const caminho of enviados) await removeAvatar(caminho).catch(() => {})
      setErro(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  const total = linhas.length + (atual.nome.trim() ? 1 : 0)
  return (
    <BottomSheet open title="Adicionar alunos" onClose={onClose}>
      <form className="initial-form" onSubmit={(e) => e.preventDefault()}>
        <label className="field">
          <span>Foto (opcional)</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Foto do aluno"
            onChange={(e) => escolherFoto(e.target.files?.[0] ?? null)}
          />
        </label>
        {atual.previa && <img className="foto-previa" src={atual.previa} alt="Prévia da foto" />}
        <label className="field">
          <span>Nome completo</span>
          <input
            value={atual.nome}
            onChange={(e) => setAtual((a) => ({ ...a, nome: e.target.value }))}
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label className="field">
          <span>E-mail (opcional)</span>
          <input
            value={atual.email}
            onChange={(e) => setAtual((a) => ({ ...a, email: e.target.value }))}
            type="email"
            autoComplete="off"
            placeholder="Para ele entrar no app depois"
          />
        </label>
        <label className="field">
          <span>Quantas aulas ele já fez</span>
          <input
            value={atual.aulas}
            onChange={(e) =>
              setAtual((a) => ({ ...a, aulas: e.target.value.replace(/[^\d]/g, '') }))
            }
            inputMode="numeric"
            maxLength={5}
          />
        </label>
        <p className="field-help">
          Ele só entrou no app agora: as aulas anteriores entram no total e na frequência.
        </p>

        {linhas.length > 0 && (
          <ul className="aluno-lista" aria-label="Alunos prontos para criar">
            {linhas.map((l) => (
              <li key={l.id}>
                {l.previa ? (
                  <img className="foto-mini" src={l.previa} alt="" aria-hidden="true" />
                ) : (
                  <span className="avatar small belt-branca" aria-hidden="true">
                    {l.nome
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                )}
                <span className="student-name">
                  <strong>{l.nome}</strong>
                  <span>
                    {rotuloAulas(aulasDoTexto(l.aulas))}
                    {l.email ? ` · ${l.email}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remover ${l.nome} da lista`}
                  onClick={() => remover(l.id)}
                >
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {erro && (
          <p className="error-message" role="alert">
            {erro}
          </p>
        )}

        <button type="button" className="secondary full" onClick={() => adicionar()}>
          <Plus size={17} /> Adicionar outro aluno
        </button>
        <ActionButton className="primary full" action={criar} disabled={pending || !total}>
          <Camera size={17} /> {rotuloBotao(total)}
        </ActionButton>
        <p className="field-help">
          O aluno entra na equipe na hora: o professor já pode lançar presença e graduar. O e-mail,
          se você informar, é o que deixa ele entrar no aplicativo mais tarde.
        </p>
      </form>
    </BottomSheet>
  )
}
