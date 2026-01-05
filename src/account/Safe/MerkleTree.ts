import { keccak256 } from "ethers";

/**
 * Hashes two values together using keccak256
 */
function hashPair(left: string, right: string): string {
    if(left < right){
      return keccak256(left + right.slice(2));
    }else{
      return keccak256(right + left.slice(2));
    }
}

/**
 * Builds a Merkle tree and returns proofs for each input hash
 * @param hashes - Array of hash strings to include in the Merkle tree
 * @returns Array of MerkleProof objects containing the original hash, its proof path, and the root
 */
export function generateMerkleProofs(hashes: string[]): [string, string[]] {
  if (hashes.length === 0) {
    throw new Error('Cannot create Merkle tree with empty hash list');
  }

  // Store the original hashes and their indices
  const originalHashes = [...hashes];
  
  // Build the tree level by level
  let currentLevel = [...hashes];
  const tree: string[][] = [currentLevel];
  
  // Build tree from bottom to top
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Hash pair of nodes
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Odd number of nodes - duplicate the last one
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i]));
      }
    }
    
    tree.push(nextLevel);
    currentLevel = nextLevel;
  }
  const root = tree[tree.length - 1][0];
  
  // Generate proof for each original hash
  const proofs: string[] = originalHashes.map((hash, index) => {
    const proofArr: string[] = [];
    let currentIndex = index;
    
    // Traverse from leaf to root, collecting sibling hashes
    for (let level = 0; level < tree.length - 1; level++) {
      const currentLevelNodes = tree[level];
      const isRightNode = currentIndex % 2 === 1;
      
      if (isRightNode) {
        // If we're the right node, sibling is on the left
        proofArr.push(currentLevelNodes[currentIndex - 1]);
      } else {
        // If we're the left node, sibling is on the right
        if (currentIndex + 1 < currentLevelNodes.length) {
          proofArr.push(currentLevelNodes[currentIndex + 1]);
        } else {
          // Odd number of nodes - we're paired with ourselves
          proofArr.push(currentLevelNodes[currentIndex]);
        }
      }
      
      // Move to parent index in next level
      currentIndex = Math.floor(currentIndex / 2);
    }
    let proof = root;
    proofArr.forEach((proofElement) =>{
        proof += proofElement.slice(2);
    });
    return proof;
  });
  return [root, proofs];
}

/**
 * Verifies a Merkle proof
 * @param hash - The original hash
 * @param proof - Array of sibling hashes from leaf to root
 * @param root - The expected Merkle root
 * @returns true if the proof is valid, false otherwise
 */
export function verifyMerkleProof(hash: string, proof: string[], root: string): boolean {
  let currentHash = hash;
  
  for (const siblingHash of proof) {
    // Determine order (smaller hash goes first for consistency)
    if (currentHash <= siblingHash) {
      currentHash = hashPair(currentHash, siblingHash);
    } else {
      currentHash = hashPair(siblingHash, currentHash);
    }
  }
  
  return currentHash === root;
}
