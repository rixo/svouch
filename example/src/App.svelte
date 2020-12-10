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
      $todos.put({ text: input })
      input = ''
    }
  }

  const sortField = 'text'
  let sortDir = 'asc'

  $: $todos.sort = [{ [sortField]: sortDir }]

  const sort = (dir) => () => {
    sortDir = dir
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

      <!-- <span class="status" hidden={!$dirty}>Dirty</span> -->
      <span class="status" hidden={!$busy}>Saving...</span>
    </div>

    <pre>
{'$todos.sort = ' + JSON.stringify($todos.sort, false, 2)}

{'$todos.selector = ' + JSON.stringify($todos.selector, false, 2)}
    </pre>

    {#await $todos.ready}
      <p>Loading...</p>
    {:then}
      <ul>
        {#each $todos as todo (todo._id)}
          <li class="todo" data-id={todo._id}>
            <input bind:value={todo.text} />
            <button
              type="button"
              on:click={() => $todos.remove(todo)}>X</button>
          </li>
        {:else}
          <p>Nothing here B-)</p>
        {/each}
      </ul>
    {:catch}
      <p>Shit?!</p>
    {/await}
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
