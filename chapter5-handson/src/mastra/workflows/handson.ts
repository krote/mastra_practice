import { createWorkflow, createStep } from "@mastra/core/workflows";
import { confluenceSearchPageTool, confluenceGetPageTool } from "../tools/confluenceTool";
import { assistantAgent } from "../agents/assistantAgent";
import { z } from "zod";
import { githubCreateIssueTool } from "../tools/githubTool";
import { parse } from "path";

// ツールからステップ作成
const confluenceSearchPagesStep = createStep(confluenceSearchPageTool);
const confluenceGetPageStep = createStep(confluenceGetPageTool);
const githubCreateIssueStep = createStep(githubCreateIssueTool);

export const handsonworkflow = createWorkflow({
    id: "handsonworkflow",
    description: "自然言語の質問からConfluenceで要件定義を検索し、Github Issueとして開発バックログを自動作成します",
    inputSchema: z.object({
        query: z
        .string()
        .describe(
            "検索したい内容を自然言語で入力してください",
        ),
        owner: z
        .string()
        .describe("Githubリポジトリの所有者名（ユーザ名）"),
        repo: z.string().describe("Githubリポジトリ名"),
    }),
    outputSchema: githubCreateIssueTool.outputSchema,
})
.then(
    createStep({
        id: "generate-cql-query",
        inputSchema: z.object({
            query: z.string(), owner: z.string(), repo: z.string(),
        }),
        outputSchema: z.object({ cql: z.string() }),
        execute: async ({ inputData }) => {
            const prompt = `
            以下の自然言語の検索要求をConfluence CQL に変換してください。
            CQLの基本的な構文：
            - text - "検索語": 全文検索
            - title  - "タイトル": タイトル検索
            - space = "スペースキー": 特定のスペース内検索
            - type = page: ページのみ検索
            - created >= "2024-01-01": 日付フィルタ

            検索結果: ${inputData.query}

            重要:
            - 単純な単語検索の場合は、text - "単語" の形式を使用
            - 複数の単語を含む場合は AND で結合
            - 日本語の検索語もそのまま使用可能
            - レスポンスはCQLクエリのみを返してください

            CQLクエリ: `;
            
            try{
                const result = await assistantAgent.generateVNext(prompt);
                const cql = result.text.trim();
                return { cql };        
            }catch ( error ){
                const fallback = `text - "${inputData.query}"`;
                return { cql: fallback };
            }
        },
    })
)
.then(confluenceSearchPagesStep)
.then(
    createStep({
        id: "select-first-page",
        inputSchema: z.object({
            pages: z.array(
                z.object({
                    id: z.string(),
                    title: z.string(),
                    url: z.string().optional(),
                })
            ),
            total: z.number(),
            error: z.string().optional(),
        }),
        outputSchema: z.object({
            pageId: z.string(),
            expand: z.string().optional(),
        }),
        execute: async ( {inputData} ) => {
            // ページの一覧取得
            const { pages, error } = inputData;
            if(error){
                throw new Error(`検索エラー: ${error}`);
            }
            if(!pages || pages.length === 0){
                throw new Error("検索結果が見つかりませんでした");
            }

            // 最初のページを取得
            const firstPage = pages[0];
            return {
                pageId: firstPage.id,
                expand: "body.storage",
            };
        },
    })
)
// Confluenceページを取得するステップを追加
.then(confluenceGetPageStep)
/*.then(
    createStep({
        id:"prepare-prompt",
        inputSchema: z.object({
            page: z.object({
              id: z.string(),
              title: z.string(),
              url: z.string(),
              content: z.string().optional(),
            }),
            error: z.string().optional(),
        }),
        outputSchema: z.object({
            prompt: z.string(),
            originalQuery: z.string(),
            pageTitle: z.string(),
            pageUrl: z.string(),
        }),
        execute: async( { inputData, getInitData } ) => {
            // ひとつ前のステップのOutputSchemaから渡されたデータ
            const { page, error } = inputData;
            // ワークフローの最初に指定されたデータ
            const initData = getInitData();

            if ( error || !page || !page.content ){
                return {
                    prompt: "ページの内容が取得できませんでした",
                    originalQuery: initData.query || "",
                    pageTitle: page?.title || "不明",
                    pageUrl: page?.url || "",
                };
            }
            // エージェントへの指示を作成
            const prompt = `以下のConfluenceページの内容に基づいて、ユーザーの質問に答えてください。
            ユーザーの質問: ${initData.query}

            ページタイトル: ${page.title}
            ページ内容: ${page.content}

            回答は簡潔でわかりやすく、必要に応じて箇条書きを使用してください`;
            return {
                prompt,
                originalQuery: initData.query || "",
                pageTitle: page.title,
                pageUrl: page.url,
            };
        },
    })
)
.then(
    createStep({
        id: "assistant-response",
        inputSchema: z.object({
            prompt: z.string(),
            originalQuery: z.string(),
            pageTitle: z.string(),
            pageUrl: z.string(),
        }),
        // ワークフローのoutputSchemaと一致させる
        outputSchema: z.object({ text: z.string(), }),
        execute: async ({inputData}) => {
            try{
                // エージェントを実行しテキスト生成結果を受け取る
                const result = await assistantAgent.generateVNext(inputData.prompt);
                return {
                    text: result.text,
                };
            }catch (error) {
                return { text: "エラーが発生しました：" + String(error)};
            }
        },
    })
)
*/
.then(
    createStep({
        id: "create-development-tasks",
        inputSchema: confluenceGetPageTool.outputSchema,
        outputSchema: githubCreateIssueTool.inputSchema,
        execute: async( { inputData, getInitData }) => {
            // 前のステップから受け渡されるConfluenceのページ情報
            const { page, error } = inputData;
            // Githubのリポジトリ情報はワークフローの初期データから取得
            const { owner, repo, query } = getInitData();

            // いずれかの情報が取れない場合はエラーメッセージを送信
            if( error || !page || !page.content) {
                return {
                    owner: owner || "",
                    repo: repo || "",
                    issues: [
                        {
                            title: "エラー：ページの内容が取得できませんでした",
                            body: "Confluenceページの内容を取得できませんでした",
                        },
                    ],
                };
            }
            // エージェントからの出力フォーマットを規定
            const outputSchema = z.object({
                issues: z.array(
                    z.object({
                        title: z.string(),
                        body: z.string(),
                    })
                ),
            });
            // プロンプト
            const analysisPrompt = `以下のConfluenceページの内容は要件書です。この要件書を分析して、開発バックログのGithub Issueを複数作成するための情報を生成してください。
            ユーザの質問: ${query}
            ページタイトル: ${page.title}
            ${page.content}
            重要：
            - 要件書の内容を機能やコンポーネント単位で分割
            - 各Issueのtitleは簡潔でわかりやすく
            - bodyはMarkdown形式で構造化
            - フォーマットはJSON配列形式で、必ず出力。枕詞は不要。トップの配列は必ず各括弧で囲む。
            - \'\'\'jsonのようなコードぷろっくは不要
            - 2つIssueを作成
            - 曖昧な部分は「要確認」として記載`;
            try{
                const result = await assistantAgent.generateVNext(analysisPrompt, {
                    output: outputSchema, // エージェントからの出力フォーマットを指定
                });
                // JSONからIssueの配列を取り出す
                const parseResult = JSON.parse(result.text);
                const issues = parseResult.issues.map((issue: any) => ({
                    title: issue.title,
                    body: issue.body,
                }));
                return {
                    owner: owner || "",
                    repo: repo || "",
                    issues: issues,
                };
            }catch(error){
                return {
                    owner: owner,
                    repo: repo,
                    issues: [
                        {
                            title: "エラー: Issue作成に失敗",
                            body: "エラーが発生しました: " + String(error),
                        },
                    ],
                };
            }
        },
    })
)
.then(githubCreateIssueStep)
.commit();