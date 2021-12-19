pragma solidity ^0.8.0;

interface IInteroperableToken {

  /**
   * @dev Creates `amount` new tokens and deposits them in the ZKP contract locked to the given commitment.
   * @param totalAmount - the total amount of the currency to transfer to the receiving institution
   * @param amounts - the different denominations that make up the totalAmount
   * @param commitments - the commitments corresponding to the secrets required to generate the ZKPs to withdraw this totalAmount from the ZKP escrow for each separate denomination
   * Requirements:
   * - the caller must have the `MINTER_ROLE`.
   */
  function mintToZKPEscrow(uint256 totalAmount, uint256[] memory amounts, bytes32[] memory commitments) external ;

  /**
   * @dev Destroys `amount` tokens from the caller and automatically mints them in the corresponding institutions ERC20 contract
   * @param totalAmount - the total amount of the currency to transfer to the receiving institution
   * @param amounts - the different denominations that make up the totalAmount
   * @param commitments - the commitments corresponding to the secrets required to generate the ZKPs to withdraw this totalAmount from the ZKP escrow for each separate denomination
   * @param institution - the institution to transfer this currency to
   */
  function burnAndTransferToConnectedInstitution(uint256 totalAmount, uint256[] memory amounts, bytes32[] memory commitments, string memory institution) external;
}
