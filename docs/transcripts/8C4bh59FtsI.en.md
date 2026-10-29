# Transcrição — memória de longo prazo em agentes multimodais

Fonte: https://www.youtube.com/watch?v=8C4bh59FtsI

Transcrição fornecida pelo usuário. Formatação e marcadores de tempo normalizados; texto em inglês preservado, inclusive possíveis erros da legenda automática. Os títulos abaixo são os capítulos fornecidos, não um título verificado do vídeo.

## 1. Intro: What should a multimodal agent remember?

[00:00] Hi, I'm Anaia.

[00:01] If your agent can hear, see, and take action, the next question is, what should they remember after the session ends.

[00:09] In this episode, I will show you the architecture for long term memory in a multi-modal agent. Facts instruction.

[00:17] Memory understanding and semantic memory and raw audio or video. Outside of memory.

[00:24] Hi there. Hey there. Good for that. Customer dinner tomorrow or just browsing.

## 2. Demo: Personal styling agent with long-term memory

[00:31] Oh, I want you to suggest something for customer dinner tomorrow based on my wish list. For sure.

[00:38] You have those leather ankle boots, and a classic black pump on your list.

[00:42] Either would go great with that red cocktail dress you bought, but if you want something a bit more relaxed for dinner, maybe mix it up with the Plaid Button Up and classic denim jeans.

[00:52] All right, let's start with the two types of the memory.

## 3. Short-term (RAM) vs. Long-term memory

[00:55] When you're talking to a multimodal agent, it feels like the agent remembers everything. It remembers what you said five minutes ago.

[01:04] You can use what you just heard, but most of that is short term memory. It is like RAM.

[01:11] It is useful while the session is running, but it's gone when the session ends. So the real design question is not can we save everything.

[01:21] The real question is, what is worth carrying into the next session. And that memory comes in two kinds.

## 4. The 2 types of memory: Facts vs. understanding

[01:29] The first kind is facts. Facts are exact. You have a dinner on Thursday. You bought the blue jacket.

[01:37] Those are things you can put in rows and columns. They have IDs. They have dates. They can be created, updated and deleted.

[01:46] That is structured memory. The second kind is understanding. Understanding is not one clean row in a table.

[01:56] It is an agent learning what something means about you. You prefer simple over flashy. You run warm.

[02:04] You reach for dark colors when you want to feel confident. That is not just a fact to look up.

[02:12] That is a pattern.

[02:14] It is a difference between knowing your calendar and knowing you. So here is the first takeaway.

[02:21] Facts are exact. You look them up. Understanding is meaning. You recall it.

[02:28] Now let's talk about the decision that makes or breaks your memory system. Those two kinds of memory should not live in the same place.

## 5. Where memory lives: SQL databases vs. vector stores

[02:37] Facts belong in a structured database.

[02:40] That usually means SQL, Postgres, MySQL, Cloud SQL and Google Cloud. Whatever fits your stack.

[02:48] Why SQL. Because facts need exact answers.

[02:52] If I ask what is on my calendar Thursday, I do not want a similar memory. I want the exact event.

[03:01] The database should return the actual rows. That is what structured databases are good at now.

[03:09] Understanding belongs somewhere else.

[03:12] Understanding states in a vector store a vector store lets you search by meaning.

[03:19] So instead of asking find a row of your preference equals dark colors.

[03:24] The agent can ask, what do I know about any style preference for this kind of event.

[03:29] And the memory system can bring back memories that are semantically related.

[03:35] And that is the job of embeddings and vector search. Here is an important detail. Vector store is a category.

## 6. Vector store options & managed memory bank

[03:44] It is not one specific product. You could use vector inside Postgres. You could use AlloyDB on Google Cloud.

[03:52] One managed option is agent platform memory bank. Memory bank is useful because it does more than store vectors.

[04:01] You can read past sessions, extract useful memories, and update those memories over time.

[04:08] So if you use a plain vector store, you usually build the extraction logic yourself.

[04:15] If you use memory bank, that part is managed for you. But the lesson is not. You must use memory bank.

[04:23] The lesson is understanding goes in a system that can search by meaning. Now, here's a mistake many people make.

## 7. Common mistake: Putting everything in a vector store

[04:31] They hear semantic memory and they put everything into the vector store. Facts preferences.

[04:39] Calendar events. Everything that sounds simple, but it creates a real problem.

[04:46] A vector store is designed for similarity.

[04:49] Similarity is great when the question is fuzzy, but similarity is dangerous when the answer must be exact.

[04:57] If the user asks, what did I buy. The agent should not guess from a similar memory.

[05:03] You should query the database if the user asks, what do I usually for dinners. Then semantic memory makes sense.

[05:12] That is the meaning based questions. So the rule is structure facts goes in database like Cloud SQL.

[05:20] Unstructured understanding goes in a vector store. And there is one more category. People often forget raw perception.

## 8. What about raw perception? (Audio & video streams)

[05:29] The camera frames the audio waveform, the live stream itself that does not usually belong in memory.

[05:37] Your agent does not need to permanently remember every Pixel or every sound wave. It needs the meaning you extract from them.

[05:46] For example, she is wearing that Black hat again or that you should set this. Dinner is formal.

[05:53] Those meanings can become memory. The raw video and audio are separate storage decision.

[06:00] You might keep them for replay, audit, debugging or training data, but that is not the same thing as agent memory.

[06:09] Agent memory should keep what matters. Not every raw signal that passes through the app.

[06:16] So here is a second takeaway.

[06:19] Facts go instruction memory like classical understanding, goes in a vector store like agent platform memory bank.

[06:29] Raw perception usually stays out of memory unless you have a separate reason to store the media itself.

[06:36] All right, let's make this concrete. How does the agent actually remember. There are two important moments.

## 9. How agents read memory at session start

[06:45] The start of a session and the end of a session.

[06:48] At the start, the agent loads memory before the conversation really begins.

[06:54] It reads structured facts from the database, for example upcoming occasions, wishlist items profile details.

[07:02] Then it searches the vector store for relevant understanding. For example, style preference, comfort constraints.

[07:09] Favorite colors from past conversations. Then the agent gets both kinds of context.

[07:15] So when the user starts talking, the agent is not starting from 0. It already has the facts and it already has a meaning.

[07:23] That is why the code works.

[07:25] The agent can say have that dinner on Thursday from the Structural database, and I know you like to keep it simple from semantic memory.

[07:35] One answer. Two memory systems. Now let's talk about saving memory.

## 10. Saving memory: Fast sync writes vs. async extraction

[07:42] Facts should usually be saved immediately. If the user says add that Blazer to my wish list.

[07:49] The agent should write that to the database right away. That is a tool call.

[07:54] It is structured, it is exact, and the user expects it to be saved. Now understanding is different.

[08:04] You usually do not want to update someone's long term identity from one random sentence.

[08:10] If I say maybe I like yellow today, that does not mean yellow is not my whole style. Understanding needs judgment.

[08:19] It should come from stronger signals. Maybe the user explains why something matters. Maybe the same pattern repeats across sessions.

[08:28] That is how you keep memory from getting noisy.

[08:31] So instead of treating every sentence as a permanent preference, you let the memory service review the conversation and extract what is actually worth keeping.

[08:42] Now, when does the extraction happen. You have a choice.

## 11. Keeping memory extraction off the live hot path

[08:47] You can extract memory during the conversation after each turn or at intervals.

[08:54] Agent platform memory bank supports this directly.

[08:58] You can trigger memory generation meet session not only at the end, and extracting as you go has real advantages.

[09:07] Shorter exchanges often produce cleaner memories, and if the user drops off early, you have already saved what they said.

[09:15] But there's a catch in a live multi-modal agent. Extraction is heavier than a database.

[09:23] A model has to read the conversation and infer meaning. That takes time and a life. Worst agent is latency sensitive.

[09:32] You cannot let a slow extraction step block the audio. So the rule is not always wait until the session ends.

[09:41] The rule is keep extraction of the live path right asynchronously after the turn or after the session, wherever.

[09:50] It will not store the conversation.

[09:53] And in this demo, the structure effects are written immediately during the conversation.

[09:59] The understanding is extracted off the hot path after the session and stored as semantic memory.

[10:06] That gives you two tracks fast synchronous writes for facts, slower asynchronous extraction for understanding,

[10:14] and the next time the user comes back and the agent loads both again. That is the loop read at the start.

[10:22] Write what changes. Bring it forward next time. Here's the third takeaway.

[10:28] Load both memory systems when the session starts so effects as soon as they happen.

[10:34] Save understanding after you have enough context to know what is actually worth remembering.

[10:41] All right, let's recap.

## 12. Architecture recap & next episode: Real time vision

[10:44] If you want your AI agent to remember users across sessions, do not start by dumping everything into one type of database.

[10:52] Start by asking what kind of memory is this. There are two main kinds. Facts are exact.

[11:00] You look them up. Understanding is meaning. You recall it.

[11:04] Facts belong in a structured database like classical understanding belongs in a vector store. Agent platform.

[11:12] Memory bank is one managed option because it can help extract and maintain that semantic memory for you.

[11:21] But the architecture works beyond one product, and raw camera frames or raw audio do not automatically become memory.

[11:29] You usually store the meaning you extract from them, not the raw signal itself.

[11:34] That is what turns a forgetful agent into an agent that can actually pick up where it left off.

[11:40] It knows the facts of your life and it understands what patterns that makes those facts useful. That's it.

[11:47] So what is the first thing you would want your agent to remember about you. Don't forget to leave that in the comments.

[11:54] In the next episode, we will give the agent eyes with real time vision. All right, I will see you in the next episode.
