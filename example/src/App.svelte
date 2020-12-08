<script>
  import { todos } from './db.js'

  // $: console.log($todos)

  const { dirty, busy } = todos

  $: {
    console.log($dirty, $busy)
  }

  let input = ''
  let query = ''

  const submit = () => {
    if (input === '') {
      // just save
      $todos.commit()
    } else {
      // add
      todos.put({ text: input })
      input = ''
    }
  }

  $todos.sort = [{ _id: 'asc' }]

  const sort = (dir) => () => {
    $todos.sort = [{ _id: dir }]
  }

  $: $todos.selector = query ? { text: { $regex: query } } : {}
</script>

<main>
  <form on:submit|preventDefault={submit}>
    <div class="topbar">
      <label><span>limit: </span><input
          type="number"
          bind:value={$todos.limit} /></label>
      <label><span>skip: </span><input
          type="number"
          bind:value={$todos.skip} /></label>
      <label><span>search:</span> <input bind:value={query} /></label>

      <label>
        <span>sort:</span>
        <button type="button" on:click={sort('asc')}>Asc</button>
        <button type="button" on:click={sort('desc')}>Desc</button>
      </label>
    </div>

    <div class="topbar">
      <input bind:value={input} />
      <button type="submit">Add</button>

      <button
        type="button"
        disabled={!$dirty}
        on:click={$todos.commit}>Save</button>

      <span class="status" hidden={!$dirty}>Dirty</span>
      <span class="status" hidden={!$busy}>Busy</span>
    </div>

    <pre>
{'$todos.sort = ' + JSON.stringify($todos.sort, false, 2)}

{'$todos.selector = ' + JSON.stringify($todos.selector, false, 2)}
    </pre>

    <ul>
      {#each $todos as todo}
        <li class="todo">
          <input bind:value={todo.text} />
          <button type="button" on:click={() => todos.remove(todo)}>X</button>
        </li>
      {:else}
        <p>All good.</p>
      {/each}
    </ul>
  </form>
</main>

<style>
  main {
    max-width: 720px;
    margin: auto;
  }

  .topbar {
    padding: 0.5rem;
    margin: 1em 0;
  }
  .topbar label {
    margin: 0 0.5em;
  }
  .topbar input[type='number'] {
    width: 3em;
  }

  ul {
    padding: 0;
  }
  li {
    list-style-type: none;
    margin: 0.5rem;
  }

  pre {
    float: right;
    margin: 0 1em 1em;
    background: lightgray;
    padding: 1em;
    border: 1px solid dimgray;
  }
</style>
